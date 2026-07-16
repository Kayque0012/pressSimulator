
const initialState = () => ({
  emergency:false, curtainBlocked:false, chockInserted:false,
  mode:"manual", left:false, right:false, reset:false,
  ready:false, valve:false, cylinder:0
});

let state = initialState();
const $ = (id) => document.getElementById(id);

function isSafe(){ return !state.emergency && !state.curtainBlocked && !state.chockInserted; }
function needsReset(){ return isSafe() && !state.ready; }

function log(message){
  const line = document.createElement("div");
  line.textContent = `${new Date().toLocaleTimeString()} — ${message}`;
  $("events").prepend(line);
}

function evaluate(){
  if(!isSafe()){
    state.ready = false;
    state.valve = false;
  } else {
    const twoHand = state.left && state.right;
    if(state.mode === "manual"){
      state.valve = state.ready && twoHand;
    } else {
      if(state.ready && twoHand && state.cylinder < .1) state.valve = true;
      if(state.cylinder > .95) state.valve = false;
    }
  }
  render();
}

function render(){
  $("ram").style.top = `${260 + state.cylinder * 82}px`;
  $("rod").style.height = `${90 + state.cylinder * 82}px`;
  $("curtain").classList.toggle("blocked",state.curtainBlocked);

  $("lampRed").classList.toggle("on",!isSafe());
  $("lampYellow").classList.toggle("on",needsReset());
  $("lampGreen").classList.toggle("on",state.ready && isSafe());

  $("sensorRet").textContent = state.cylinder < .08 ? "ATIVO" : "INATIVO";
  $("sensorAdv").textContent = state.cylinder > .92 ? "ATIVO" : "INATIVO";
  $("valveText").textContent = state.valve ? "ATIVA" : "INATIVA";

  let status = "Máquina pronta";
  let color = "var(--green)";
  if(state.emergency){ status="Emergência acionada"; color="var(--red)"; }
  else if(state.curtainBlocked){ status="Cortina interrompida"; color="var(--red)"; }
  else if(state.chockInserted){ status="Calço inserido"; color="var(--red)"; }
  else if(needsReset()){ status="Aguardando reset"; color="var(--yellow)"; }
  $("statusText").textContent = status;
  $("statusDot").style.background = color;

  const signals = [
    ["I01","Emergência CH1",!state.emergency],
    ["I02","Emergência CH2",!state.emergency],
    ["I03","Bimanual esquerdo",state.left],
    ["I04","Bimanual direito",state.right],
    ["I05","Cortina CH1",!state.curtainBlocked],
    ["I06","Cortina CH2",!state.curtainBlocked],
    ["I07","Reset",state.reset],
    ["I08","Sensor recuado",state.cylinder < .08],
    ["I09","Sensor avançado",state.cylinder > .92],
    ["I10","Calço recolhido",!state.chockInserted],
    ["Q01","Válvula pneumática",state.valve],
    ["Q02","LED reset",needsReset()],
    ["Q03","Torre verde",state.ready && isSafe()],
    ["Q04","Torre amarela",needsReset()],
    ["Q05","Torre vermelha",!isSafe()]
  ];

  $("ioTable").innerHTML = signals.map(([id,label,value]) =>
    `<tr><td>${id}</td><td>${label}</td><td class="${value?"on":"off"}">${value?"ATIVO":"INATIVO"}</td></tr>`
  ).join("");
}

function holdButton(id,key){
  const el = $(id);
  ["mousedown","touchstart"].forEach(evt => el.addEventListener(evt,e => {
    e.preventDefault(); state[key]=true; evaluate();
  }));
  ["mouseup","mouseleave","touchend"].forEach(evt => el.addEventListener(evt,e => {
    e.preventDefault(); state[key]=false; evaluate();
  }));
}

holdButton("leftHand","left");
holdButton("rightHand","right");

$("emergency").addEventListener("click",()=>{
  state.emergency=!state.emergency;
  log(state.emergency?"Emergência acionada":"Emergência liberada");
  evaluate();
});

$("curtainButton").addEventListener("click",()=>{
  state.curtainBlocked=!state.curtainBlocked;
  $("curtainButton").textContent=state.curtainBlocked?"Liberar cortina":"Interromper cortina";
  log(state.curtainBlocked?"Cortina interrompida":"Cortina liberada");
  evaluate();
});

$("chock").addEventListener("click",()=>{
  state.chockInserted=!state.chockInserted;
  $("chock").textContent=state.chockInserted?"Remover calço":"Inserir calço";
  log(state.chockInserted?"Calço inserido":"Calço removido");
  evaluate();
});

$("mode").addEventListener("change",e=>{
  state.mode=e.target.value;
  log(`Modo alterado para ${state.mode}`);
  evaluate();
});

["mousedown","touchstart"].forEach(evt => $("resetButton").addEventListener(evt,e=>{
  e.preventDefault();
  state.reset=true;
  if(isSafe()){state.ready=true;log("Reset aceito — máquina pronta");}
  evaluate();
}));
["mouseup","mouseleave","touchend"].forEach(evt => $("resetButton").addEventListener(evt,e=>{
  e.preventDefault();state.reset=false;evaluate();
}));

$("resetScene").addEventListener("click",()=>{
  state=initialState();
  $("mode").value="manual";
  $("curtainButton").textContent="Interromper cortina";
  $("chock").textContent="Inserir calço";
  log("Cenário restaurado");
  evaluate();
});

$("msxFile").addEventListener("change",e=>{
  const file=e.target.files[0];
  if(file) log(`Arquivo selecionado: ${file.name} — parser será integrado na próxima etapa`);
});

document.addEventListener("keydown",e=>{
  if(e.repeat)return;
  if(e.key.toLowerCase()==="a")state.left=true;
  if(e.key.toLowerCase()==="d")state.right=true;
  if(e.code==="Space"){e.preventDefault();state.reset=true;if(isSafe())state.ready=true;}
  evaluate();
});
document.addEventListener("keyup",e=>{
  if(e.key.toLowerCase()==="a")state.left=false;
  if(e.key.toLowerCase()==="d")state.right=false;
  if(e.code==="Space")state.reset=false;
  evaluate();
});

let last=performance.now();
function tick(now){
  const dt=Math.min((now-last)/1000,.05);last=now;
  const target=state.valve?1:0;
  const speed=.9;
  if(state.cylinder<target)state.cylinder=Math.min(target,state.cylinder+speed*dt);
  if(state.cylinder>target)state.cylinder=Math.max(target,state.cylinder-speed*dt);
  render();
  requestAnimationFrame(tick);
}
log("pressSimulator iniciado");
evaluate();
requestAnimationFrame(tick);
