import { useEffect, useState } from 'react'

export default function SpreadsheetPreview({ file }: { file: Blob }) {
  const [rows, setRows] = useState<string[][]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const XLSX = await import('xlsx')
        const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const data = sheet ? XLSX.utils.sheet_to_json<Array<string | number | boolean>>(sheet, { header: 1, raw: false, defval: '' }) : []
        if (active) setRows(data.map((row) => row.map(String)))
      } catch {
        if (active) setError('This spreadsheet could not be previewed. Use Download to open it locally.')
      }
    })()
    return () => { active = false }
  }, [file])

  if (error) return <p className="spreadsheet-preview-error">{error}</p>
  if (!rows.length) return <p className="spreadsheet-preview-error">This spreadsheet is empty.</p>

  return <div className="spreadsheet-preview"><table><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => rowIndex === 0 ? <th key={cellIndex}>{cell}</th> : <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>
}
