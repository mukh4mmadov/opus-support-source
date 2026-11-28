type Cell = string | number | null

export async function downloadExcel(fileName: string, head: string[], rows: Cell[][]) {
  const { default: writeExcelFile } = await import('write-excel-file/browser')
  const header = head.map((value) => ({ value, fontWeight: 'bold' as const }))
  const body = rows.map((row) => row.map((value) => ({ value: value ?? '' })))
  await writeExcelFile([header, ...body]).toFile(fileName)
}

export async function downloadWorkbook(fileName: string, lists: Record<string, Record<string, unknown>[]>) {
  const { default: writeExcelFile } = await import('write-excel-file/browser')
  const sheets = Object.entries(lists).map(([sheet, rows]) => {
    const columns = Object.keys(rows[0] ?? { empty: '' })
    const cell = (value: unknown) => ({
      value: value === null || value === undefined ? '' : typeof value === 'number' ? value : String(value),
    })
    return {
      sheet,
      data: [
        columns.map((value) => ({ value, fontWeight: 'bold' as const })),
        ...rows.map((row) => columns.map((column) => cell(row[column]))),
      ],
    }
  })
  await writeExcelFile(sheets).toFile(fileName)
}

export interface ImportedPerson {
  first_name: string
  last_name: string
  birth_year: number | null
}

export async function readPeople(file: File) {
  const { default: readExcelFile } = await import('read-excel-file/browser')
  const sheets = await readExcelFile(file)
  const rows = sheets[0]?.data ?? []
  const people: ImportedPerson[] = []
  for (const row of rows) {
    const first = String(row[0] ?? '').trim()
    const last = String(row[1] ?? '').trim()
    const year = Number(row[2])
    if (!first || !last) continue
    if (/^(first|name|ism)/i.test(first)) continue
    people.push({ first_name: first, last_name: last, birth_year: Number.isInteger(year) && year > 0 ? year : null })
  }
  return people
}
