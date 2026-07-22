const DIRECTION_CONFIG = {
  Input: {
    prefix: "I",
    group: "input"
  },

  Output: {
    prefix: "OS",
    group: "safeOutput"
  },

  OutputStatus: {
    prefix: "ST",
    group: "statusOutput"
  }
};

function normalizeValue(value) {
  return String(value ?? "").trim();
}

function buildModuleKey(ioElement, ownerElement) {
  const directCandidates = [
    ioElement.getAttribute("Module"),
    ioElement.getAttribute("ModuleId"),
    ioElement.getAttribute("ModuleIdentifier"),
    ioElement.getAttribute("Device"),
    ioElement.getAttribute("DeviceId")
  ];

  const directValue = directCandidates
    .map(normalizeValue)
    .find(Boolean);

  if (directValue) {
    return directValue;
  }

  let parent = ownerElement?.parentElement || null;

  while (parent) {
    const parentCandidates = [
  parent.getAttribute("Module"),
  parent.getAttribute("ModuleId"),
  parent.getAttribute("ModuleIdentifier"),
  parent.getAttribute("Device"),
  parent.getAttribute("DeviceId"),
  parent.getAttribute("Board"),
  parent.getAttribute("BoardId"),
  parent.getAttribute("Unit"),
  parent.getAttribute("UnitId")
];

    const parentValue = parentCandidates
      .map(normalizeValue)
      .find(Boolean);

    if (parentValue) {
      return parentValue;
    }

    parent = parent.parentElement;
  }

  return "M1S";
}

export class IoResolver {
  constructor() {
    this.moduleOrder = new Map();
    this.usedAddresses = new Map();
    this.moduleCounter = 0;
  }

  reset() {
    this.moduleOrder.clear();
    this.usedAddresses.clear();
    this.moduleCounter = 0;
  }

  registerModule(moduleKey) {
    if (!this.moduleOrder.has(moduleKey)) {
      this.moduleOrder.set(moduleKey, this.moduleCounter);
      this.moduleCounter += 1;
    }

    return this.moduleOrder.get(moduleKey);
  }

  resolve(ownerElement) {
    const ioElement = ownerElement.querySelector(":scope > IOModule");

    if (!ioElement) {
      return null;
    }

    const direction = normalizeValue(
      ioElement.getAttribute("Direction")
    );

    const config = DIRECTION_CONFIG[direction];

    if (!config) {
      return {
        direction,
        group: null,
        address: null,
        baseAddress: null,
        index: null,
        moduleId: null,
        moduleOrder: null,
        moduleLabel: null
      };
    }

    const rawIndex = Number(
      ioElement.getAttribute("Index")
    );

    if (!Number.isInteger(rawIndex) || rawIndex < 0) {
      return {
        direction,
        group: config.group,
        address: null,
        baseAddress: null,
        index: null,
        moduleId: null,
        moduleOrder: null,
        moduleLabel: null
      };
    }

    const baseAddress =
      `${config.prefix}${rawIndex + 1}`;

    const moduleKey =
      buildModuleKey(ioElement, ownerElement);

    let moduleOrder =
      this.registerModule(moduleKey);

    let address = moduleOrder === 0
      ? baseAddress
      : `M${moduleOrder + 1}.${baseAddress}`;

    const addressOccurrence =
      this.usedAddresses.get(address) || 0;

    if (addressOccurrence > 0) {
      moduleOrder = Math.max(
        moduleOrder,
        this.moduleCounter
      );

      address =
        `M${moduleOrder + 1}.${baseAddress}`;

      while (this.usedAddresses.has(address)) {
        moduleOrder += 1;

        address =
          `M${moduleOrder + 1}.${baseAddress}`;
      }

      this.moduleCounter =
        Math.max(
          this.moduleCounter,
          moduleOrder + 1
        );
    }

    this.usedAddresses.set(
      address,
      addressOccurrence + 1
    );

    return {
      direction,
      group: config.group,

      index: rawIndex,

      address,
      baseAddress,

      moduleId: moduleKey,
      moduleOrder,

      moduleLabel: moduleOrder === 0
        ? "M1S"
        : `Módulo ${moduleOrder + 1}`
    };
  }
}
