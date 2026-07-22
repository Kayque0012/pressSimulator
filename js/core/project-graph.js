export class ProjectGraph {
  constructor({ fileName = "projeto.msx", version = null } = {}) {
    this.fileName = fileName;
    this.version = version;

    this.blocks = new Map();
    this.connections = [];

    this.inputs = new Map();
    this.safeOutputs = new Map();
    this.statusOutputs = new Map();

    this.modules = new Map();
    this.pages = new Map();

    this.warnings = [];
    this.errors = [];
  }

  addBlock(block) {
    if (!block?.id) {
      this.warnings.push({
        type: "BLOCK_WITHOUT_ID",
        message: "Um bloco sem identificador foi ignorado."
      });

      return;
    }

    if (this.blocks.has(block.id)) {
      this.warnings.push({
        type: "DUPLICATE_BLOCK_ID",
        blockId: block.id,
        message: `Bloco duplicado: ${block.id}`
      });
    }

    this.blocks.set(block.id, block);

    if (block.io?.group === "input") {
      this.inputs.set(block.id, block);
    }

    if (block.io?.group === "safeOutput") {
      this.safeOutputs.set(block.id, block);
    }

    if (block.io?.group === "statusOutput") {
      this.statusOutputs.set(block.id, block);
    }
  }

  addConnection(connection) {
    if (
      !connection?.source?.blockId ||
      !connection?.target?.blockId
    ) {
      this.warnings.push({
        type: "INVALID_CONNECTION",
        connection,
        message: "Conexão incompleta ignorada."
      });

      return;
    }

    this.connections.push(connection);
  }

  addModule(module) {
    if (!module?.id) {
      return;
    }

    if (!this.modules.has(module.id)) {
      this.modules.set(module.id, {
        ...module,
        inputs: [],
        safeOutputs: [],
        statusOutputs: []
      });
    }
  }

  getBlock(blockId) {
    return this.blocks.get(blockId) || null;
  }

  getIncomingConnections(blockId) {
    return this.connections.filter(
      connection =>
        connection.target.blockId === blockId
    );
  }

  getOutgoingConnections(blockId) {
    return this.connections.filter(
      connection =>
        connection.source.blockId === blockId
    );
  }

  getUnknownBlocks() {
    return [...this.blocks.values()].filter(
      block => block.supportLevel === "unknown"
    );
  }

  toJSON() {
    return {
      fileName: this.fileName,
      version: this.version,

      blocks: [...this.blocks.values()],
      connections: this.connections,

      inputs: [...this.inputs.values()],
      safeOutputs: [...this.safeOutputs.values()],
      statusOutputs: [...this.statusOutputs.values()],

      modules: [...this.modules.values()],
      pages: [...this.pages.values()],

      warnings: this.warnings,
      errors: this.errors
    };
  }
}
