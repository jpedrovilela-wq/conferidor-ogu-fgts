importScripts('prioritarios-worker.js?v=5');

const baseHandler = self.onmessage;
const send = self.postMessage.bind(self);
let requestData = null;

const trim = value => String(value ?? '').trim();
const canonical = value => trim(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[’'`´.\-]/g, '').replace(/\s+/g, ' ');
const cityPair = (actual, expected) => `${canonical(actual)}|${canonical(expected)}`;
const attentionPairs = new Set([
  cityPair('SERIDÓ', 'São Vicente do Seridó'),
  cityPair('EMBU', 'Embu das Artes'),
  cityPair('MUNICIPIO DE GURUPA', 'Gurupá'),
  cityPair('ZONA RURAL DE CERRO CORA', 'Cerro Corá'),
  cityPair('COMUNIDADE QUILOMBOLA DE NOSSA SENHORA DAS GRACAS-CRAVO S/N', 'Concórdia do Pará'),
  cityPair('CUMUNIDADE QUILOMBOLA DE NOSSA SENHORA DAS GRACAS CRAVO S/N', 'Concórdia do Pará')
]);

function similarity(left, right) {
  const a = canonical(left), b = canonical(right);
  if (!a || !b) return 0;
  const table = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) table[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) table[i][j] = Math.min(table[i - 1][j] + 1, table[i][j - 1] + 1, table[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - table[a.length][b.length] / Math.max(a.length, b.length);
}

function sourceMap(raw, agent) {
  const headers = raw?.[0] || [];
  const index = Object.fromEntries(headers.map((header, column) => [canonical(header), column]));
  const value = (row, header) => row[index[canonical(header)]] ?? '';
  const statuses = new Set((agent === 'bb' ? ['CONCLUÍDO E ENTREGUE', 'OBRA NÃO INICIADA', 'EM ANDAMENTO', 'PARALISADO', 'DISTRATADO/CANCELADO', 'DESIMOBILIZADO'] : ['CONCLUÍDO E ENTREGUE', 'OBRA NÃO INICIADA', 'EM ANDAMENTO', 'PARALISADO', 'FASE PROJETO', 'DISTRATADO/CANCELADO', 'DESIMOBILIZADO', 'NOVO']).map(canonical));
  const output = new Map();
  raw.slice(1).forEach((row, position) => {
    const current = value(row, 'Situação do Empreendimento');
    const january = value(row, 'Situação do Empreendimento em Janeiro do ano de referência');
    output.set(position + 2, {
      uf: canonical(value(row, 'UF')),
      municipality: value(row, 'Município'),
      cep: trim(value(row, 'CEP do imóvel')),
      address: {
        'Logradouro do imóvel': trim(value(row, 'Logradouro do imóvel')),
        'Número do imóvel': trim(value(row, 'Número do imóvel')),
        'Bairro do imóvel': trim(value(row, 'Bairro do imóvel'))
      },
      statuses: [
        !statuses.has(canonical(current)) && { value: current, rule: 'Situação do Empreendimento atual fora da lista consolidada.' },
        !statuses.has(canonical(january)) && { value: january, rule: 'Situação do Empreendimento em janeiro do ano de referência fora da lista consolidada.' }
      ].filter(Boolean)
    });
  });
  return output;
}

function formatDate(value) {
  const text = trim(value);
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial > 0 && serial < 100000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000).toISOString().slice(0, 10);
  }
  const brazilian = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return brazilian ? `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}` : text;
}

function referenceDate(raw) {
  const headers = raw?.[0] || [];
  const column = headers.findIndex(header => canonical(header) === canonical('Data de Movimento'));
  return column < 0 ? '' : formatDate(raw?.[1]?.[column]);
}

function rebuild(message) {
  const summary = {}, rows = message.rows;
  let impeditivos = 0, atencoes = 0;
  rows.forEach(row => {
    const key = `${row[2]}|${row[3]}`;
    summary[key] = (summary[key] || 0) + 1;
    if (row[3] === 'IMPEDITIVO') impeditivos++;
    if (row[3] === 'ATENÇÃO') atencoes++;
  });
  message.summary = summary;
  message.impeditivos = impeditivos;
  message.atencoes = atencoes;
}

function revise(message) {
  if (message.type !== 'complete' || !requestData?.primary) return message;
  const info = sourceMap(requestData.primary, requestData.agente);
  message.reference = referenceDate(requestData.primary);
  const revised = [], incompleteAddresses = new Set();
  for (const original of message.rows) {
    const row = [...original], meta = info.get(Number(row[0]));
    if (['Logradouro do imóvel está em branco.', 'Número do imóvel está em branco.', 'Bairro do imóvel está em branco.'].includes(row[2])) {
      if (incompleteAddresses.has(row[0])) continue;
      incompleteAddresses.add(row[0]);
      row[2] = 'Endereço do imóvel incompleto: Logradouro, Número do imóvel e/ou Bairro do imóvel estão em branco.';
      row[4] = Object.entries(meta?.address || {}).filter(([, value]) => !value).map(([field]) => `${field}: em branco`).join('; ');
      row[5] = 'Logradouro, Número do imóvel e Bairro do imóvel preenchidos';
    }
    if (row[2] === 'Situação do Empreendimento fora da lista permitida.') {
      const occurrence = meta?.statuses.shift();
      if (!occurrence) continue;
      row[2] = occurrence.rule;
      row[4] = occurrence.value;
    }
    if (row[2] === 'CEP deve possuir 8 dígitos numéricos.') {
      const digits = /^\d+$/.test(meta?.cep || '') ? meta.cep.length : 0;
      if (digits === 7 && meta.uf === 'SP') continue;
      if (digits === 7) { row[2] = 'CEP com 7 dígitos fora da UF São Paulo.'; row[3] = 'ATENÇÃO'; row[5] = '8 dígitos ou 7 dígitos para UF São Paulo'; }
      else if (digits <= 6) { row[2] = 'CEP deve possuir 8 dígitos numéricos; excepcionalmente, são aceitos 7 dígitos para a UF São Paulo.'; row[5] = '8 dígitos numéricos, ou 7 dígitos para a UF São Paulo'; }
      else { row[2] = 'CEP deve possuir 7 ou 8 dígitos numéricos.'; row[5] = '8 dígitos ou 7 dígitos para UF São Paulo'; }
    }
    if (row[2] === 'Código IBGE do Município inválido.' && /^\d{6}$/.test(trim(row[4])) && self.ibgeMunicipios?.[trim(row[4])]) {
      const [municipality, uf] = self.ibgeMunicipios[trim(row[4])];
      if (canonical(meta?.municipality) !== canonical(municipality)) { row[2] = 'Município não corresponde ao Código IBGE.'; row[4] = meta?.municipality || ''; row[5] = municipality; }
      else if (meta?.uf !== uf) { row[2] = 'UF não corresponde ao Código IBGE.'; row[4] = meta?.uf || ''; row[5] = uf; }
      else continue;
    }
    if (row[2] === 'Código IBGE do Município inválido.' && /^0+$/.test(trim(row[4]))) row[2] = 'Código IBGE do Município inválido ou igual a Zero.';
    if (row[2] === 'Município não corresponde ao Código IBGE.') {
      const score = similarity(row[4], row[5]);
      if (canonical(row[4]) === canonical(row[5]) || score >= .92) continue;
      if (attentionPairs.has(cityPair(row[4], row[5])) || score >= .74) { row[2] = 'Nome do Município possui divergência relevante em relação ao Código IBGE.'; row[3] = 'ATENÇÃO'; }
    }
    revised.push(row);
  }
  message.rows = revised;
  rebuild(message);
  return message;
}

self.onmessage = event => { requestData = event.data; baseHandler(event); };
self.postMessage = message => send(revise(message));
