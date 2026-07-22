import { ProjectGraph } from "./project-graph.js";
import { IoResolver } from "./io-resolver.js";

function firstAttribute(element, names) {
  for (const name of names) {
    const value = element.getAttribute(name);

    if (value !== null && value !== "") {
      return value;
    }
  }

  return null;
}

function getClassName(rawType) {
  return String(rawType || "")
    .split(".")
    .pop()
    .trim();
}

function readDirectText(element, selector) {
  return element
    .querySelector(`:scope > ${selector}`)
    ?.textContent
    ?.trim() || null;
}

function readParameters(element) {
  const parameters = {};

  [...element.attributes].forEach(attribute => {
    parameters[attribute.name] = attribute.value;
  });

  [...element.children].forEach(child => {
    if (child.children.length === 0) {
      const value = child.textContent?.trim();

      if (value !== "") {
        parameters[child.tagName] = value;
      }
    }
  });

  return parameters;
}

function detectBlockElements(xml) {
  return [
    ...xml.querySelectorAll("MosaicItem")
  ];
}

function detectConnections(xml) {
  return [
    ...xml.querySelectorAll(
      "MosaicConnection, Connection, Wire, Link, Edge"
    )
  ]
    .map((element, index) => {
      const sourceId = firstAttribute(element, [
        "SourceId",
        "source",
        "from",
        "src",
        "fromBlock"
      ]);

      const targetId = firstAttribute(element, [
        "SinkId",
        "TargetId",
        "target",
        "to",
        "dst",
        "toBlock"
      ]);

      if (!sourceId || !targetId) {
        return null;
      }

      return {
        id:
          firstAttribute(element, [
            "ItemIdentifier",
            "id",
            "uid",
            "guid"
          ]) || `C${index + 1}`,

        source: {
          blockId: sourceId,

          port:
            firstAttribute(element, [
              "SourceConnectorName",
              "sourcePort",
              "fromPort",
              "srcPort"
            ]) || "OUT"
        },

        target: {
          blockId: targetId,

          port:
            firstAttribute(element, [
              "SinkConnectorName",
              "TargetConnectorName",
              "targetPort",
              "toPort",
              "dstPort"
            ]) || "IN"
        }
      };
    })
    .filter(Boolean);
}

function extractXmlFromMsx(buffer) {
  const bytes = new Uint8Array(buffer);

  const text = new TextDecoder(
    "utf-8",
    { fatal: false }
  ).decode(bytes);

  const xmlStart = text.indexOf("<?xml");

  if (xmlStart === -1) {
    throw new Error(
      "O arquivo MSX não contém um XML reconhecível."
    );
  }

  const closingTag = "</MosaicDiagram>";
  const xmlEnd = text.indexOf(
    closingTag,
    xmlStart
  );

  if (xmlEnd === -1) {
    throw new Error(
      "O fechamento do MosaicDiagram não foi encontrado."
    );
  }

  return text.slice(
    xmlStart,
    xmlEnd + closingTag.length
  );
}

export class MsxParserV2 {
  constructor({ blockRegistry = {} } = {}) {
    this.blockRegistry = blockRegistry;
    this.ioResolver = new IoResolver();
  }

  async parseFile(file) {
    if (!file) {
      throw new Error("Nenhum arquivo foi informado.");
    }

    const buffer = await file.arrayBuffer();
    const xmlText = extractXmlFromMsx(buffer);

    return this.parseXml(
      xmlText,
      file.name
    );
  }

  parseXml(xmlText, fileName = "projeto.msx") {
    this.ioResolver.reset();

    const xml = new DOMParser().parseFromString(
      xmlText,
      "application/xml"
    );

    const parserError =
      xml.querySelector("parsererror");

    if (parserError) {
      throw new Error(
        "O XML interno do MSX não pôde ser interpretado."
      );
    }

    const root =
      xml.querySelector("MosaicDiagram");

    const graph = new ProjectGraph({
      fileName,

      version:
        root?.getAttribute("Version") ||
        root?.getAttribute("DiagramVersion") ||
        null
    });

    const elements = detectBlockElements(xml);

    elements.forEach((element, index) => {
      const rawType =
        firstAttribute(element, [
          "Type",
          "type",
          "class",
          "ItemName",
          "name"
        ]) || element.tagName;

      const className =
        getClassName(rawType);

      const registration =
        this.blockRegistry[className] || null;

      const id =
        firstAttribute(element, [
          "ItemIdentifier",
          "id",
          "uid",
          "guid",
          "instanceId",
          "blockId"
        ]) || `B${index + 1}`;

      const description =
        readDirectText(
          element,
          "ChangeUserDescription"
        );

      const wireName =
        readDirectText(
          element,
          "ChangeNomeFilo"
        );

      const io =
        this.ioResolver.resolve(element);

      const block = {
        id: String(id),

        rawType,
        className,

        type:
          registration?.type ||
          className,

        supportLevel:
          registration?.level ||
          "unknown",

        family:
          registration?.family ||
          "Não catalogado",

        name:
          description ||
          wireName ||
          firstAttribute(element, [
            "ItemName",
            "label",
            "displayName",
            "description",
            "name"
          ]) ||
          className,

        wireName,

        io,

        address:
          io?.address || null,

        baseAddress:
          io?.baseAddress || null,

        parameters:
          readParameters(element)
      };

      graph.addBlock(block);

      if (io?.moduleId) {
        graph.addModule({
          id: io.moduleId,
          order: io.moduleOrder,
          label: io.moduleLabel
        });
      }
    });

    detectConnections(xml)
      .forEach(connection => {
        graph.addConnection(connection);
      });

    this.connectInterpageSignals(graph);

    this.validateGraph(graph);

    return graph;
  }

  connectInterpageSignals(graph) {
    const outputs = [
      ...graph.blocks.values()
    ].filter(block =>
      block.className === "InterpaginaOutItem" &&
      block.wireName
    );

    const inputs = [
      ...graph.blocks.values()
    ].filter(block =>
      block.className === "InterpaginaInItem" &&
      block.wireName
    );

    outputs.forEach(source => {
      inputs
        .filter(
          target =>
            target.wireName === source.wireName
        )
        .forEach((target, index) => {
          graph.addConnection({
            id:
              `WIRE_${source.id}_${target.id}_${index}`,

            source: {
              blockId: source.id,
              port: "WIRE"
            },

            target: {
              blockId: target.id,
              port: "WIRE"
            }
          });
        });
    });
  }

  validateGraph(graph) {
    graph.connections.forEach(connection => {
      if (!graph.blocks.has(
        connection.source.blockId
      )) {
        graph.warnings.push({
          type: "MISSING_SOURCE_BLOCK",
          connectionId: connection.id,
          blockId: connection.source.blockId
        });
      }

      if (!graph.blocks.has(
        connection.target.blockId
      )) {
        graph.warnings.push({
          type: "MISSING_TARGET_BLOCK",
          connectionId: connection.id,
          blockId: connection.target.blockId
        });
      }
    });

    const addresses = new Map();

    [
      ...graph.inputs.values(),
      ...graph.safeOutputs.values(),
      ...graph.statusOutputs.values()
    ].forEach(block => {
      const address = block.address;

      if (!address) {
        return;
      }

      if (addresses.has(address)) {
        graph.errors.push({
          type: "DUPLICATE_IO_ADDRESS",
          address,
          firstBlockId: addresses.get(address),
          secondBlockId: block.id
        });
      } else {
        addresses.set(address, block.id);
      }
    });
  }
}
