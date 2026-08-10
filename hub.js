const frame=document.getElementById('rotina');
const originNotice=document.getElementById('arquivo-origem');
function setRoutine(group){
  const routes={ogu:'ogu.html',fgts:'fgts.html',rcb:'rcb.html?v=5',prioritarios:'prioritarios.html?v=1'};
  const labels={ogu:'OGU',fgts:'FGTS',rcb:'Reforma Casa Brasil',prioritarios:'Dados Prioritários'};
  frame.src=routes[group];
  frame.title=`Rotina de conferência ${labels[group]}`;
  originNotice.innerHTML=group==='fgts'
    ? '<strong>Arquivo esperado:</strong> envie o CSV ou TXT extraído de <code>view_exportar_fgts_casa_civil</code>.'
    : group==='ogu'
      ? '<strong>Arquivo esperado:</strong> envie o CSV ou TXT extraído de <code>view_exportar_ogu_casa_civil</code>.'
      : group==='rcb'
        ? '<strong>Arquivo esperado:</strong> envie o CSV ou TXT extraído de <code>view_exportar_rcb_casa_civil</code>.'
        : '<strong>Arquivos esperados:</strong> Dados Prioritários de Empreendimentos ou Entregas, da CAIXA ou do Banco do Brasil.';
}
document.querySelectorAll('input[name="grupo"]').forEach(input=>input.addEventListener('change',event=>setRoutine(event.target.value)));
