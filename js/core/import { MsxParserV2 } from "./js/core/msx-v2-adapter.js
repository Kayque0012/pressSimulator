import { MsxParserV2 } from "./msx-parser-v2.js";

export class MsxV2Adapter {
  constructor({
    blockRegistry = {},
    logger = console
  } = {}) {
    this.logger = logger;
    this.parser = new MsxParserV2({
      blockRegistry
    });

    this.graph = null;
  }

  async loadFile(file) {
    try {
      this.graph =
        await this.parser.parseFile(file);

      this.logSummary();

      return this.graph;
    } catch (error) {
      this.graph = null;

      this.logger.error(
        "[MSX V2] Falha ao carregar projeto:",
        error
      );

      throw error;
    }
  }

  getProjectSummary() {
    if (!this.graph) {
      return null;
    }

    const json = this.graph.toJSON();

    return {
      fileName: json.fileName,
      version: json.version,

      totalBlocks:
        json.blocks.length,

      totalConnections:
        json.connections.length,

      inputs:
        json.inputs.map(block =>
          this.toIoSignal(block)
        ),

      safeOutputs:
        json.safeOutputs.map(block =>
          this.toIoSignal(block)
        ),

      statusOutputs:
        json.statusOutputs.map(block =>
          this.toIoSignal(block)
        ),

      modules:
        json.modules,

      warnings:
        json.warnings,

      errors:
        json.errors,

      unknownBlocks:
        json.blocks
          .filter(
            block =>
              block.supportLevel === "unknown"
          )
          .map(block => ({
            id: block.id,
            className: block.className,
            rawType: block.rawType,
            name: block.name
          }))
    };
  }

  toIoSignal(block) {
    return {
      blockId:
        block.id,

      address:
        block.address,

      baseAddress:
        block.baseAddress,

      name:
        block.name,

      className:
        block.className,

      group:
        block.io?.group || null,

      direction:
        block.io?.direction || null,

      moduleId:
        block.io?.moduleId || null,

      moduleOrder:
        block.io?.moduleOrder ?? null,

      moduleLabel:
        block.io?.moduleLabel || null,

      index:
        block.io?.index ?? null
    };
  }

  getInputs() {
    const summary =
      this.getProjectSummary();

    return summary?.inputs || [];
  }

  getSafeOutputs() {
    const summary =
      this.getProjectSummary();

    return summary?.safeOutputs || [];
  }

  getStatusOutputs() {
    const summary =
      this.getProjectSummary();

    return summary?.statusOutputs || [];
  }

  getAllOutputs() {
    return [
      ...this.getSafeOutputs(),
      ...this.getStatusOutputs()
    ];
  }

  hasErrors() {
    return Boolean(
      this.graph?.errors?.length
    );
  }

  hasUnknownBlocks() {
    return Boolean(
      this.getProjectSummary()
        ?.unknownBlocks
        ?.length
    );
  }

  logSummary() {
    const summary =
      this.getProjectSummary();

    if (!summary) {
      return;
    }

    this.logger.group(
      `[MSX V2] ${summary.fileName}`
    );

    this.logger.log(
      "Versão:",
      summary.version || "não informada"
    );

    this.logger.log(
      "Blocos:",
      summary.totalBlocks
    );

    this.logger.log(
      "Conexões:",
      summary.totalConnections
    );

    this.logger.log(
      "Entradas:",
      summary.inputs.length
    );

    this.logger.table(
      summary.inputs
    );

    this.logger.log(
      "Saídas seguras:",
      summary.safeOutputs.length
    );

    this.logger.table(
      summary.safeOutputs
    );

    this.logger.log(
      "Saídas de status:",
      summary.statusOutputs.length
    );

    this.logger.table(
      summary.statusOutputs
    );

    if (summary.unknownBlocks.length) {
      this.logger.warn(
        "Blocos desconhecidos:",
        summary.unknownBlocks
      );
    }

    if (summary.warnings.length) {
      this.logger.warn(
        "Avisos:",
        summary.warnings
      );
    }

    if (summary.errors.length) {
      this.logger.error(
        "Erros:",
        summary.errors
      );
    }

    this.logger.groupEnd();
  }

  clear() {
    this.graph = null;
  }
}
