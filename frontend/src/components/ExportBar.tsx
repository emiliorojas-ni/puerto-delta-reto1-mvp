import type { MouseEvent } from 'react'
import { api, mockCsvDataUrl } from '../api'

export function ExportBar({ idPrefix = 'export' }: { idPrefix?: string }) {
  const csvHref = api.exportUrl('csv')
  const xlsxHref = api.exportUrl('xlsx')

  const handleMockCsv = (e: MouseEvent<HTMLAnchorElement>) => {
    if (api.mode === 'mock') {
      e.preventDefault()
      const a = document.createElement('a')
      a.href = mockCsvDataUrl()
      a.download = 'resultados_reto1_lote1_mock.csv'
      document.body.appendChild(a)
      a.click()
      a.remove()
    }
  }

  return (
    <div className="header-actions" role="group" aria-label="Exportación de resultados">
      <a
        id={`${idPrefix}-csv-btn`}
        href={csvHref}
        onClick={handleMockCsv}
        className="btn btn-sm"
        download
      >
        Exportar CSV
      </a>
      <a
        id={`${idPrefix}-xlsx-btn`}
        href={xlsxHref}
        className="btn btn-sm"
        download
      >
        Exportar Excel
      </a>
    </div>
  )
}
