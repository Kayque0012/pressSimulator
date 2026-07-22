import { MsxV2Adapter } from "./core/msx-v2-adapter.js";

import {
  graphToRuntimeProject
} from "./core/runtime-project-adapter.js";

window.PRESS_SIMULATOR_USE_V2 = true;

let adapter = null;

window.pressSimulatorV2 = {
  adapter: null,
  graph: null,
  summary: null,
  runtimeProject: null
};

function logV2(message) {
  console.log(`[PressSimulator V2] ${message}`);
}

function getBlockRegistry() {
  const registry =
    window.MOSAIC_BLOCK_REGISTRY;

  if (!registry) {
    throw new Error(
      "O catálogo MOSAIC_BLOCK_REGISTRY não foi disponibilizado pelo app.js."
    );
  }

  return registry;
}

function initializeAdapter() {
  const blockRegistry =
    getBlockRegistry();

  adapter = new MsxV2Adapter({
    blockRegistry
  });

  window.pressSimulatorV2.adapter =
    adapter;

  logV2(
    `${Object.keys(blockRegistry).length} tipos de bloco carregados no parser V2.`
  );
}

function showSummary(summary) {
  console.group(
    "[PressSimulator V2] Resultado do parser"
  );

  console.log("Arquivo:", summary.fileName);
  console.log("Versão:", summary.version);
  console.log("Blocos:", summary.totalBlocks);
  console.log("Conexões:", summary.totalConnections);

  console.log("Entradas:");
  console.table(summary.inputs);

  console.log("Saídas seguras:");
  console.table(summary.safeOutputs);

  console.log("Saídas de status:");
  console.table(summary.statusOutputs);

  console.log("Módulos:");
  console.table(summary.modules);

  console.log(
    "Blocos desconhecidos:",
    summary.unknownBlocks.length
  );

  if (summary.unknownBlocks.length) {
    console.warn(
      summary.unknownBlocks
    );
  }

  if (summary.warnings.length) {
    console.warn(
      "Avisos:",
      summary.warnings
    );
  }

  if (summary.errors.length) {
    console.error(
      "Erros:",
      summary.errors
    );
  }

  console.groupEnd();
}

async function loadProjectWithV2(file) {
  if (!adapter) {
    initializeAdapter();
  }

  logV2(`Analisando ${file.name}...`);

  const graph =
    await adapter.loadFile(file);

  const summary =
    adapter.getProjectSummary();

  const runtimeProject =
    graphToRuntimeProject(graph);

  window.pressSimulatorV2.graph =
    graph;

  window.pressSimulatorV2.summary =
    summary;

  window.pressSimulatorV2.runtimeProject =
    runtimeProject;

  showSummary(summary);

  window.dispatchEvent(
    new CustomEvent(
      "presssimulator:v2-project-ready",
      {
        detail: {
          graph,
          summary,
          runtimeProject
        }
      }
    )
  );

  logV2(
    "Projeto V2 enviado ao motor lógico."
  );
}

function connectMsxInput() {
  try {
    initializeAdapter();
  } catch (error) {
    console.error(
      "[PressSimulator V2] Falha na inicialização:",
      error
    );

    return;
  }

  const input =
    document.getElementById("msxFile");

  if (!input) {
    console.warn(
      "[PressSimulator V2] Campo msxFile não encontrado."
    );

    return;
  }

  input.addEventListener(
    "change",
    async event => {
      const file =
        event.target.files?.[0];

      if (!file) {
        return;
      }

      try {
        await loadProjectWithV2(file);
      } catch (error) {
        console.error(
          "[PressSimulator V2] Erro:",
          error
        );
      }
    },
    {
      capture: true
    }
  );

  logV2(
    "Parser V2 conectado ao campo de arquivo."
  );
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    connectMsxInput
  );
} else {
  connectMsxInput();
}
