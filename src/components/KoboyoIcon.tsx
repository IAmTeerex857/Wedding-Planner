import type { CSSProperties, HTMLAttributes } from 'react'

/* oxlint-disable react/only-export-components -- This module intentionally mirrors an icon package API. */

type IconProps = Omit<HTMLAttributes<HTMLSpanElement>, 'color'> & {
  size?: number | string
  strokeWidth?: number
  color?: string
}

function createIcon(slug: string) {
  return function KoboyoIcon({ size = 24, className = '', color, style, strokeWidth: _strokeWidth, ...props }: IconProps) {
    return (
      <span
        {...props}
        aria-hidden={props['aria-label'] ? undefined : true}
        className={`koboyo-icon ${className}`.trim()}
        style={{
          '--koboyo-icon': `url("/koboyo/${slug}.svg")`,
          width: size,
          height: size,
          color,
          ...style,
        } as CSSProperties}
      />
    )
  }
}

export const AlignJustify = createIcon('list')
export const Armchair = createIcon('armchair')
export const ArrowDownLeft = createIcon('arrow-down-left')
export const ArrowRight = createIcon('arrow-right')
export const ArrowUpRight = createIcon('arrow-up-right')
export const BedDouble = createIcon('bed-double')
export const Boxes = createIcon('boxes')
export const CalendarDays = createIcon('calendar-days')
export const CalendarPlus = createIcon('calendar-plus')
export const ChartNoAxesCombined = createIcon('chart-no-axes-combined')
export const Check = createIcon('check')
export const CheckCircle2 = createIcon('check')
export const ChevronDown = createIcon('chevron-down')
export const ChevronRight = createIcon('chevron-right')
export const Circle = createIcon('circle')
export const CircleDollarSign = createIcon('circle-dollar-sign')
export const ClipboardCheck = createIcon('clipboard-check')
export const Clock3 = createIcon('clock-3')
export const Columns3 = createIcon('columns-3')
export const Download = createIcon('download')
export const File = createIcon('file')
export const FileImage = createIcon('file-image')
export const FileSpreadsheet = createIcon('file-spreadsheet')
export const FileText = createIcon('file-text')
export const FolderLock = createIcon('folder-lock')
export const Gift = createIcon('gift')
export const HeartHandshake = createIcon('heart-handshake')
export const LayoutDashboard = createIcon('layout-dashboard')
export const ListPlus = createIcon('list-plus')
export const Lock = createIcon('lock')
export const LogOut = createIcon('log-out')
export const Mail = createIcon('mail')
export const MailCheck = createIcon('mail-check')
export const MapPin = createIcon('map-pin')
export const Menu = createIcon('menu')
export const PackageCheck = createIcon('package-check')
export const Pencil = createIcon('pencil')
export const Phone = createIcon('phone')
export const Plane = createIcon('plane')
export const Plus = createIcon('plus')
export const Printer = createIcon('file-text')
export const ReceiptText = createIcon('receipt-text')
export const RotateCcw = createIcon('rotate-ccw')
export const Search = createIcon('search')
export const Settings = createIcon('settings')
export const Shirt = createIcon('shirt')
export const Store = createIcon('store')
export const Tag = createIcon('tag')
export const Trash2 = createIcon('trash-2')
export const Truck = createIcon('truck')
export const Unlock = createIcon('unlock')
export const Upload = createIcon('upload')
export const UserPlus = createIcon('user-plus')
export const UserRound = createIcon('user-round')
export const Users = createIcon('users')
export const Utensils = createIcon('utensils')
export const WalletCards = createIcon('wallet-cards')
export const X = createIcon('x')
