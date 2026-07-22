export function graphToRuntimeProject(graph) {
  if (!graph) {
    throw new Error("ProjectGraph não informado.");
  }

  const blocks = [...graph.blocks.values()].map(block => ({
    ...block,

    ioGroup:
      block.io?.group || null,

    ioDirection:
      block.io?.direction || null,

    ioModuleId:
      block.io?.moduleId || null,

    ioModuleOrder:
      block.io?.moduleOrder ?? null,

    ioModuleLabel:
      block.io?.moduleLabel || null,

    address:
      block.address ||
      block.io?.address ||
      null,

    baseAddress:
      block.baseAddress ||
      block.io?.baseAddress ||
      null
  }));

  const connections = graph.connections.map(connection => ({
    id: connection.id,

    source: {
      blockId: connection.source.blockId,
      port: connection.source.port || "OUT"
    },

    target: {
      blockId: connection.target.blockId,
      port: connection.target.port || "IN"
    }
  }));

  return {
    fileName: graph.fileName,
    version: graph.version || "desconhecida",

    blocks,
    connections,

    inputs:
      blocks.filter(
        block => block.ioGroup === "input"
      ),

    safeOutputs:
      blocks.filter(
        block => block.ioGroup === "safeOutput"
      ),

    statusOutputs:
      blocks.filter(
        block => block.ioGroup === "statusOutput"
      ),

    outputs:
      blocks.filter(block =>
        ["safeOutput", "statusOutput"]
          .includes(block.ioGroup)
      ),

    supportedBlocks:
      blocks.filter(
        block => block.supportLevel === "full"
      ),

    partialBlocks:
      blocks.filter(
        block => block.supportLevel === "partial"
      ),

    catalogBlocks:
      blocks.filter(
        block => block.supportLevel === "catalog"
      ),

    unknownBlocks:
      blocks.filter(
        block => block.supportLevel === "unknown"
      ),

    warnings:
      [...graph.warnings],

    errors:
      [...graph.errors],

    parsedAt:
      new Date().toISOString(),

    parserVersion:
      "V2"
  };
}
