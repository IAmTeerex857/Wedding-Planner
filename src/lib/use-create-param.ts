import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Opens a page's create flow when the sidebar "New" menu navigates here with
 * `?new=1`, then clears the parameter so the same menu item works twice in a
 * row and a reload does not reopen the form.
 */
export function useCreateParam(open: () => void) {
  const [searchParams, setSearchParams] = useSearchParams()
  const latest = useRef(open)

  useEffect(() => { latest.current = open })

  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    // oxlint-disable-next-line react/set-state-in-effect -- The URL is the external
    // system being synchronised here: the menu navigates, the page opens its form.
    latest.current()
    setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])
}
