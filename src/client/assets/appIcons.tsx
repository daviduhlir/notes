import type { SVGProps } from 'react'

function IconBase(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props} />
}

export function PencilIcon(props: SVGProps<SVGSVGElement>) {
  return <IconBase {...props}><path d="M14.5 4.5l5 5L8 21H3v-5z" /><path d="M13 6l5 5" /></IconBase>
}

export function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return <IconBase {...props}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /><path d="M10 10v6" /><path d="M14 10v6" /></IconBase>
}

export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return <IconBase {...props}><path d="M12 5v14" /><path d="M5 12h14" /></IconBase>
}

export function ChecklistIcon(props: SVGProps<SVGSVGElement>) {
  return <IconBase {...props}><path d="M4 6h2" /><path d="M8 6h12" /><path d="M4 12h2" /><path d="M8 12h12" /><path d="M4 18h2" /><path d="M8 18h12" /><path d="M4.5 5.5l1 1 1.5-1.5" /><path d="M4.5 11.5l1 1 1.5-1.5" /><path d="M4.5 17.5l1 1 1.5-1.5" /></IconBase>
}

export function ArrowLeftIcon(props: SVGProps<SVGSVGElement>) {
  return <IconBase {...props}><path d="M10 6 4 12l6 6" /><path d="M4 12h16" /></IconBase>
}

export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return <IconBase {...props}><path d="M5 13l4 4L19 7" /></IconBase>
}
