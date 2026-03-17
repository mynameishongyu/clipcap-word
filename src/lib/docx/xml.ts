import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

export function parseXml(xml: string) {
  return new DOMParser().parseFromString(xml, "application/xml");
}

export function serializeXml(document: XMLDocument) {
  return new XMLSerializer().serializeToString(document);
}

export function localNameOf(node: Node | null) {
  if (!node) {
    return "";
  }

  const elementLike = node as Node & { localName?: string };
  if (elementLike.localName) {
    return elementLike.localName;
  }

  return node.nodeName.split(":").pop() ?? node.nodeName;
}

export function getElementChildren(node: Node) {
  const children: Element[] = [];

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === child.ELEMENT_NODE) {
      children.push(child as Element);
    }
  }

  return children;
}

export function getAttributeLocal(element: Element, localName: string) {
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (!attribute) {
      continue;
    }

    const attributeLocalName = attribute.localName ?? attribute.name.split(":").pop();
    if (attributeLocalName === localName) {
      return attribute.value;
    }
  }

  return "";
}

export function findFirstDescendant(root: Element | XMLDocument, localName: string) {
  const queue: Element[] = [];

  if ("documentElement" in root) {
    if (root.documentElement) {
      queue.push(root.documentElement);
    }
  } else {
    queue.push(root);
  }

  while (queue.length > 0) {
    const element = queue.shift()!;
    if (localNameOf(element) === localName) {
      return element;
    }

    queue.push(...getElementChildren(element));
  }

  return null;
}

export function findDescendants(root: Element | XMLDocument, localName: string) {
  const matches: Element[] = [];
  const queue: Element[] = [];

  if ("documentElement" in root) {
    if (root.documentElement) {
      queue.push(root.documentElement);
    }
  } else {
    queue.push(root);
  }

  while (queue.length > 0) {
    const element = queue.shift()!;
    if (localNameOf(element) === localName) {
      matches.push(element);
    }

    queue.push(...getElementChildren(element));
  }

  return matches;
}

export function getElementPath(node: Element, stopAt?: Element | null) {
  const path: number[] = [];
  let current: Node | null = node;

  while (current && current.nodeType === current.ELEMENT_NODE) {
    const parent = current.parentNode;
    if (!parent || parent.nodeType !== parent.ELEMENT_NODE) {
      break;
    }

    const parentElement = parent as Element;
    const siblings = getElementChildren(parentElement);
    const index = siblings.findIndex((candidate) => candidate === current);
    path.unshift(index);

    if (stopAt && parentElement === stopAt) {
      break;
    }

    current = parentElement;
  }

  return path;
}

export function resolveElementPath(root: Element, path: number[]) {
  let current: Element | null = root;

  for (const index of path) {
    if (!current) {
      return null;
    }

    current = getElementChildren(current)[index] ?? null;
  }

  return current;
}

export function resolvePartPath(basePartPath: string, target: string) {
  const baseSegments = basePartPath.split("/");
  baseSegments.pop();

  for (const segment of target.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      baseSegments.pop();
    } else {
      baseSegments.push(segment);
    }
  }

  return baseSegments.join("/");
}

export function hasLeadingOrTrailingWhitespace(text: string) {
  return /^\s|\s$/.test(text);
}
