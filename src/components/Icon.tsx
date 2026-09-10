/* oxlint-disable react/only-export-components -- This module intentionally mirrors an icon package API. */
import type { ComponentType, SVGAttributes } from 'react'
import {
  Airplane,
  ArrowLeft as PhArrowLeft,
  ArrowUp as PhArrowUp,
  ChatsCircle,
  ClockCounterClockwise,
  NotePencil,
  Waveform as PhWaveform,
  Microphone as PhMicrophone,
  Paperclip as PhPaperclip,
  PushPin as PhPushPin,
  SidebarSimple as PhSidebarSimple,
  Sparkle as PhSparkle,
  Stop as PhStop,
  Chair,
  ArrowCounterClockwise,
  ArrowDownLeft as PhArrowDownLeft,
  ArrowRight as PhArrowRight,
  ArrowUpRight as PhArrowUpRight,
  Bed,
  CalendarDots,
  CalendarPlus as PhCalendarPlus,
  CaretDown,
  CaretRight,
  CaretUpDown,
  ChartLineUp,
  Check as PhCheck,
  CheckCircle,
  Circle as PhCircle,
  ClipboardText,
  Clock,
  Columns,
  CurrencyCircleDollar,
  DownloadSimple,
  Envelope,
  EnvelopeSimple,
  File as PhFile,
  FileImage as PhFileImage,
  FileText as PhFileText,
  FileXls,
  FolderLock as PhFolderLock,
  ForkKnife,
  Gear,
  Gift as PhGift,
  Handshake,
  List,
  ListPlus as PhListPlus,
  Lock as PhLock,
  LockOpen,
  MagnifyingGlass,
  MapPin as PhMapPin,
  Package,
  PencilSimple,
  Phone as PhPhone,
  Plus as PhPlus,
  Printer as PhPrinter,
  Receipt,
  SignOut,
  SquaresFour,
  Stack,
  Storefront,
  Tag as PhTag,
  TextAlignJustify,
  Trash,
  TShirt,
  Truck as PhTruck,
  UploadSimple,
  User,
  UserPlus as PhUserPlus,
  Users as PhUsers,
  Wallet,
  X as PhX,
} from '@phosphor-icons/react'

type IconProps = {
  size?: number | string
  className?: string
  color?: string
  /** Accepted for call-site compatibility; Phosphor uses `weight`, not stroke width. */
  strokeWidth?: number
  'aria-label'?: string
} & Omit<SVGAttributes<SVGSVGElement>, 'color' | 'width' | 'height'>

type PhosphorIcon = ComponentType<{ size?: number | string; weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone'; color?: string; className?: string }>

/**
 * Every icon in the app comes from Phosphor, at one weight, through this module.
 * Wrapping rather than re-exporting keeps a single class hook for CSS, drops the
 * `strokeWidth` prop the old icon set accepted, and marks icons decorative
 * unless a call site gives them a label.
 */
function icon(Component: PhosphorIcon, extraClass = '') {
  return function AppIcon({ size = 20, className = '', strokeWidth: _strokeWidth, ...props }: IconProps) {
    return (
      <Component
        {...props}
        aria-hidden={props['aria-label'] ? undefined : true}
        className={`app-icon ${extraClass} ${className}`.trim()}
        size={size}
        weight="regular"
      />
    )
  }
}

export const ArrowLeft = icon(PhArrowLeft)
export const ArrowUp = icon(PhArrowUp)
export const Chats = icon(ChatsCircle)
export const History = icon(ClockCounterClockwise)
export const NewChat = icon(NotePencil)
export const Waveform = icon(PhWaveform)
export const Microphone = icon(PhMicrophone)
export const Paperclip = icon(PhPaperclip)
export const PushPin = icon(PhPushPin)
export const SidebarSimple = icon(PhSidebarSimple)
export const Sparkle = icon(PhSparkle)
export const Stop = icon(PhStop)
export const AlignJustify = icon(TextAlignJustify)
export const Armchair = icon(Chair)
export const ArrowDownLeft = icon(PhArrowDownLeft)
export const ArrowRight = icon(PhArrowRight)
export const ArrowUpRight = icon(PhArrowUpRight)
export const BedDouble = icon(Bed)
export const Boxes = icon(Stack)
export const CalendarDays = icon(CalendarDots)
export const CalendarPlus = icon(PhCalendarPlus)
export const ChartNoAxesCombined = icon(ChartLineUp)
export const Check = icon(PhCheck)
export const CheckCircle2 = icon(CheckCircle)
export const ChevronDown = icon(CaretDown)
export const ChevronRight = icon(CaretRight)
export const ChevronUpDown = icon(CaretUpDown)
export const Circle = icon(PhCircle)
export const CircleDollarSign = icon(CurrencyCircleDollar)
export const ClipboardCheck = icon(ClipboardText)
export const Clock3 = icon(Clock)
export const Columns3 = icon(Columns)
export const Download = icon(DownloadSimple)
export const File = icon(PhFile)
export const FileImage = icon(PhFileImage)
export const FileSpreadsheet = icon(FileXls)
export const FileText = icon(PhFileText)
export const FolderLock = icon(PhFolderLock)
export const Gift = icon(PhGift)
export const HeartHandshake = icon(Handshake)
export const LayoutDashboard = icon(SquaresFour)
export const ListPlus = icon(PhListPlus)
export const Lock = icon(PhLock)
export const LogOut = icon(SignOut)
export const Mail = icon(Envelope)
export const MailCheck = icon(EnvelopeSimple)
export const MapPin = icon(PhMapPin)
export const Menu = icon(List)
export const PackageCheck = icon(Package)
export const Pencil = icon(PencilSimple)
export const Phone = icon(PhPhone)
export const Plane = icon(Airplane)
export const Plus = icon(PhPlus)
export const Printer = icon(PhPrinter)
export const ReceiptText = icon(Receipt)
export const RotateCcw = icon(ArrowCounterClockwise)
export const Search = icon(MagnifyingGlass)
export const Settings = icon(Gear)
export const Shirt = icon(TShirt)
export const Store = icon(Storefront)
export const Tag = icon(PhTag)
export const Trash2 = icon(Trash)
export const Truck = icon(PhTruck)
export const Unlock = icon(LockOpen)
export const Upload = icon(UploadSimple)
export const UserPlus = icon(PhUserPlus)
export const UserRound = icon(User)
export const Users = icon(PhUsers)
export const Utensils = icon(ForkKnife)
export const WalletCards = icon(Wallet)
export const X = icon(PhX)
