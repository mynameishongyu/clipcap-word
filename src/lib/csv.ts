function escapeCell(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return value;
}

export function createCsv(rows: string[][]) {
  return rows.map((row) => row.map((cell) => escapeCell(cell)).join(",")).join("\n");
}
