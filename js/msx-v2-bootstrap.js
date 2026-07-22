import { MsxV2Adapter } from "./core/msx-v2-adapter.js";

const adapter = new MsxV2Adapter();

window.pressSimulatorV2 = {
  adapter,
  graph: null,
  summary: null
};

function logV2(message) {
  console.log(`[PressSimulator V2] ${message}`);
}

function showSummary(summary) {
  console.group("[PressSimulator V2] Resultado do parser");

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

  if (summary.unknownBlocks.length) {
    console.warn(
      "Blocos desconhecidos:",
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

function connectMsxInput() {
  const input = document.getElementById("msxFile");

  if (!input) {
    console.warn(
      "[PressSimulator V2] Campo msxFile não encontrado."
    );

    return;
  }

  input.addEventListener("change", async event => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      logV2(`Analisando ${file.name}...`);

      const graph =
        await adapter.loadFile(file);

      const summary =
        adapter.getProjectSummary();

      window.pressSimulatorV2.graph = graph;
      window.pressSimulatorV2.summary = summary;

      showSummary(summary);

      logV2("Arquivo analisado com sucesso.");
    } catch (error) {
      console.error(
        "[PressSimulator V2] Erro:",
        error
      );
    }
  });

  logV2("Parser V2 conectado ao campo de arquivo.");
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    connectMsxInput
  );
} else {
  connectMsxInput();
}
