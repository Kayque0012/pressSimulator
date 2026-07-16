const initialState = () => ({
  emergency: false,

  curtainBlocked: false,

  chockInserted: false,

  mode: "manual",

  left: false,

  right: false,

  reset: false,

  ready: false,

  valve: false,

  cylinder: 0
});

let state = initialState();

const $ = id => document.getElementById(id);

/* =========================================================
   REGRAS TEMPORÁRIAS DO MODO DEMONSTRAÇÃO
========================================================= */

function isSafe() {

  return (
    !state.emergency &&
    !state.curtainBlocked &&
    !state.chockInserted
  );

}

function needsReset() {

  return (
    isSafe() &&
    !state.ready
  );

}

/* =========================================================
   LOG DE EVENTOS
========================================================= */

function log(message) {

  const line = document.createElement("div");

  line.textContent =
    `${new Date().toLocaleTimeString()}  ●  ${message}`;

  $("events").prepend(line);

}

/* =========================================================
   MOTOR TEMPORÁRIO DA DEMONSTRAÇÃO
========================================================= */

function evaluate() {

  if (!isSafe()) {

    state.ready = false;

    state.valve = false;

  } else {

    const twoHand =
      state.left &&
      state.right;

    if (state.mode === "manual") {

      state.valve =
        state.ready &&
        twoHand;

    } else {

      if (
        state.ready &&
        twoHand &&
        state.cylinder < 0.1
      ) {

        state.valve = true;

      }

      if (state.cylinder > 0.95) {

        state.valve = false;

      }

    }

  }

  render();

}

/* =========================================================
   TABELAS DE I/O
========================================================= */

function renderTable(targetId, signals) {

  $(targetId).innerHTML = signals
    .map(([id, label, value]) => `

      <tr>

        <td>
          ${id}
        </td>

        <td>
          ${label}
        </td>

        <td>

          <span class="state-tag ${value ? "on" : ""}">

            ${value ? "ATIVO" : "INATIVO"}

          </span>

        </td>

        <td>

          ${value ? 1 : 0}

          <span class="state-dot ${value ? "on" : ""}">
          </span>

        </td>

      </tr>

    `)
    .join("");

}

/* =========================================================
   ATUALIZAÇÃO VISUAL
========================================================= */

function render() {

  $("ram").style.top =
    `${257 + state.cylinder * 82}px`;

  $("rod").style.height =
    `${98 + state.cylinder * 82}px`;

  $("curtain").classList.toggle(
    "blocked",
    state.curtainBlocked
  );

  $("lampRed").classList.toggle(
    "on",
    !isSafe()
  );

  $("lampYellow").classList.toggle(
    "on",
    needsReset()
  );

  $("lampGreen").classList.toggle(
    "on",
    state.ready && isSafe()
  );

  $("resetLed").classList.toggle(
    "on",
    needsReset()
  );

  $("chockLed").classList.toggle(
    "on",
    !state.chockInserted
  );

  const sensorRetracted =
    state.cylinder < 0.08;

  const sensorExtended =
    state.cylinder > 0.92;

  $("sensorRet").textContent =
    sensorRetracted
      ? "ATIVO"
      : "INATIVO";

  $("sensorAdv").textContent =
    sensorExtended
      ? "ATIVO"
      : "INATIVO";

  $("sensorRetLed").classList.toggle(
    "on",
    sensorRetracted
  );

  $("sensorAdvLed").classList.toggle(
    "green",
    sensorExtended
  );

  $("sensorAdvLed").classList.toggle(
    "on",
    sensorExtended
  );

  const percentage =
    Math.round(
      state.cylinder * 100
    );

  $("positionBar").style.width =
    `${percentage}%`;

  $("miniFill").style.width =
    `${percentage}%`;

  let position =
    "EM MOVIMENTO";

  if (sensorRetracted) {

    position =
      "RECUADO";

  }

  if (sensorExtended) {

    position =
      "AVANÇADO";

  }

  $("positionText").textContent =
    position;

  const inputs = [

    [
      "I1",
      "Emergência CH1",
      !state.emergency
    ],

    [
      "I2",
      "Emergência CH2",
      !state.emergency
    ],

    [
      "I3",
      "Bimanual esquerdo",
      state.left
    ],

    [
      "I4",
      "Bimanual direito",
      state.right
    ],

    [
      "I5",
      "Cortina de luz CH1",
      !state.curtainBlocked
    ],

    [
      "I6",
      "Cortina de luz CH2",
      !state.curtainBlocked
    ],

    [
      "I7",
      "Calço monitorado",
      !state.chockInserted
    ],

    [
      "I8",
      "Sensor recuado",
      sensorRetracted
    ],

    [
      "I9",
      "Sensor avançado",
      sensorExtended
    ],

    [
      "I10",
      "Seletora manual",
      state.mode === "manual"
    ],

    [
      "I11",
      "Seletora automático",
      state.mode === "automatic"
    ],

    [
      "I12",
      "Reset",
      state.reset
    ],

    [
      "I13",
      "Pressão OK",
      true
    ]

  ];

  const outputs = [

    [
      "Q1",
      "Válvula pneumática",
      state.valve
    ],

    [
      "Q2",
      "Torre verde",
      state.ready && isSafe()
    ],

    [
      "Q3",
      "Torre amarela",
      needsReset()
    ],

    [
      "Q4",
      "Torre vermelha",
      !isSafe()
    ],

    [
      "Q5",
      "LED reset",
      needsReset()
    ],

    [
      "Q6",
      "Buzzer",
      false
    ]

  ];

  renderTable(
    "inputTable",
    inputs
  );

  renderTable(
    "outputTable",
    outputs
  );

}

/* =========================================================
   BOTÕES DE PRESSÃO CONTÍNUA
========================================================= */

function holdButton(id, key) {

  const element =
    $(id);

  [
    "mousedown",
    "touchstart"
  ].forEach(eventName => {

    element.addEventListener(
      eventName,
      event => {

        event.preventDefault();

        state[key] =
          true;

        element.classList.add(
          "active"
        );

        evaluate();

      }
    );

  });

  [
    "mouseup",
    "mouseleave",
    "touchend"
  ].forEach(eventName => {

    element.addEventListener(
      eventName,
      event => {

        event.preventDefault();

        state[key] =
          false;

        element.classList.remove(
          "active"
        );

        evaluate();

      }
    );

  });

}

holdButton(
  "leftHand",
  "left"
);

holdButton(
  "rightHand",
  "right"
);

/* =========================================================
   EMERGÊNCIA
========================================================= */

$("emergency").addEventListener(
  "click",
  () => {

    state.emergency =
      !state.emergency;

    log(
      state.emergency
        ? "Emergência acionada"
        : "Emergência liberada"
    );

    evaluate();

  }
);

/* =========================================================
   CORTINA
========================================================= */

$("curtainButton").addEventListener(
  "click",
  () => {

    state.curtainBlocked =
      !state.curtainBlocked;

    $("curtainButton").textContent =
      state.curtainBlocked
        ? "Liberar cortina"
        : "Interromper cortina";

    log(
      state.curtainBlocked
        ? "Cortina interrompida"
        : "Cortina liberada"
    );

    evaluate();

  }
);

/* =========================================================
   CALÇO MONITORADO
========================================================= */

$("chock").addEventListener(
  "click",
  () => {

    state.chockInserted =
      !state.chockInserted;

    $("chock").classList.toggle(
      "active",
      state.chockInserted
    );

    log(
      state.chockInserted
        ? "Calço inserido"
        : "Calço removido"
    );

    evaluate();

  }
);

/* =========================================================
   SELETORA
========================================================= */

$("mode").addEventListener(
  "change",
  event => {

    state.mode =
      event.target.value;

    log(
      `Modo alterado para ${state.mode}`
    );

    evaluate();

  }
);

/* =========================================================
   RESET
========================================================= */

[
  "mousedown",
  "touchstart"
].forEach(eventName => {

  $("resetButton").addEventListener(
    eventName,
    event => {

      event.preventDefault();

      state.reset =
        true;

      $("resetButton").classList.add(
        "active"
      );

      if (isSafe()) {

        state.ready =
          true;

        log(
          "Reset aceito — máquina pronta"
        );

      }

      evaluate();

    }
  );

});

[
  "mouseup",
  "mouseleave",
  "touchend"
].forEach(eventName => {

  $("resetButton").addEventListener(
    eventName,
    event => {

      event.preventDefault();

      state.reset =
        false;

      $("resetButton").classList.remove(
        "active"
      );

      evaluate();

    }
  );

});

/* =========================================================
   IMPORTAÇÃO DO ARQUIVO
========================================================= */

$("msxFile").addEventListener(
  "change",
  event => {

    const file =
      event.target.files[0];

    if (file) {

      $("projectName").textContent =
        file.name;

      log(
        `Arquivo selecionado: ${file.name}`
      );

    }

  }
);

/* =========================================================
   ATALHOS DO TECLADO
========================================================= */

document.addEventListener(
  "keydown",
  event => {

    if (event.repeat) {

      return;

    }

    if (
      event.key.toLowerCase() === "a"
    ) {

      state.left =
        true;

      $("leftHand").classList.add(
        "active"
      );

    }

    if (
      event.key.toLowerCase() === "d"
    ) {

      state.right =
        true;

      $("rightHand").classList.add(
        "active"
      );

    }

    if (
      event.key.toLowerCase() === "e"
    ) {

      state.emergency =
        !state.emergency;

      log(
        state.emergency
          ? "Emergência acionada"
          : "Emergência liberada"
      );

    }

    if (
      event.key.toLowerCase() === "m"
    ) {

      state.mode =
        state.mode === "manual"
          ? "automatic"
          : "manual";

      $("mode").value =
        state.mode;

    }

    if (
      event.code === "Space"
    ) {

      event.preventDefault();

      state.reset =
        true;

      $("resetButton").classList.add(
        "active"
      );

      if (isSafe()) {

        state.ready =
          true;

      }

    }

    evaluate();

  }
);

document.addEventListener(
  "keyup",
  event => {

    if (
      event.key.toLowerCase() === "a"
    ) {

      state.left =
        false;

      $("leftHand").classList.remove(
        "active"
      );

    }

    if (
      event.key.toLowerCase() === "d"
    ) {

      state.right =
        false;

      $("rightHand").classList.remove(
        "active"
      );

    }

    if (
      event.code === "Space"
    ) {

      state.reset =
        false;

      $("resetButton").classList.remove(
        "active"
      );

    }

    evaluate();

  }
);

/* =========================================================
   ANIMAÇÃO DO CILINDRO
========================================================= */

let last =
  performance.now();

function tick(now) {

  const dt =
    Math.min(
      (now - last) / 1000,
      0.05
    );

  last =
    now;

  const target =
    state.valve
      ? 1
      : 0;

  const speed =
    0.9;

  if (
    state.cylinder < target
  ) {

    state.cylinder =
      Math.min(
        target,
        state.cylinder + speed * dt
      );

  }

  if (
    state.cylinder > target
  ) {

    state.cylinder =
      Math.max(
        target,
        state.cylinder - speed * dt
      );

  }

  render();

  requestAnimationFrame(
    tick
  );

}

/* =========================================================
   INICIALIZAÇÃO
========================================================= */

log(
  "Sistema iniciado"
);

log(
  "Modo demonstração ativo"
);

evaluate();

requestAnimationFrame(
  tick
);
/* =========================================================
   NAVEGAÇÃO ENTRE PÁGINAS
========================================================= */

const navItems =
  document.querySelectorAll(".nav-item");

const pages =
  document.querySelectorAll(".page");

function openPage(pageId) {

  pages.forEach(page => {

    page.classList.remove(
      "active-page"
    );

  });

  navItems.forEach(item => {

    item.classList.remove(
      "active"
    );

  });

  const targetPage =
    document.getElementById(pageId);

  if (targetPage) {

    targetPage.classList.add(
      "active-page"
    );

  }

  const targetButton =
    document.querySelector(
      `[data-page="${pageId}"]`
    );

  if (targetButton) {

    targetButton.classList.add(
      "active"
    );

  }

}

navItems.forEach(item => {

  item.addEventListener(
    "click",
    () => {

      openPage(
        item.dataset.page
      );

    }
  );

});

$("openIoMapButton").addEventListener(
  "click",
  () => {

    openPage("io-map");

  }
);

$("openSettingsButton").addEventListener(
  "click",
  () => {

    openPage("settings");

  }
);

/* =========================================================
   LED DE RESET PISCANDO
========================================================= */

function updateResetLed() {

  const led =
    $("resetLed");

  led.classList.remove(
    "on",
    "blinking"
  );

  if (needsReset()) {

    led.classList.add(
      "blinking"
    );

  }

  if (
    state.ready &&
    isSafe()
  ) {

    led.classList.add(
      "on"
    );

  }

}

/* =========================================================
   SINCRONIZAÇÃO DAS TABELAS
========================================================= */

function syncMonitorTables() {

  const inputHtml =
    $("inputTable").innerHTML;

  const outputHtml =
    $("outputTable").innerHTML;

  $("monitorInputTable").innerHTML =
    inputHtml;

  $("monitorOutputTable").innerHTML =
    outputHtml;

}

/* =========================================================
   EVENTOS NA PÁGINA COMPLETA
========================================================= */

function syncFullEvents() {

  $("fullEvents").innerHTML =
    $("events").innerHTML;

}

$("clearEventsButton").addEventListener(
  "click",
  () => {

    $("events").innerHTML = "";

    $("fullEvents").innerHTML = "";

  }
);
