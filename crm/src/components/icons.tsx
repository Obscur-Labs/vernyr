import {
  ArrowLeftIcon as LuArrowLeft,
  BellIcon as LuBell,
  BookOpenIcon as LuBookOpen,
  Building2Icon as LuBuilding,
  CalendarIcon as LuCalendar,
  ChartColumnIcon as LuChart,
  CheckIcon as LuCheck,
  ChevronDownIcon as LuChevronDown,
  ChevronRightIcon as LuChevronRight,
  ClipboardListIcon as LuClipboard,
  ClockIcon as LuClock,
  CreditCardIcon as LuCreditCard,
  DownloadIcon as LuDownload,
  ExternalLinkIcon as LuExternalLink,
  EyeIcon as LuEye,
  FileTextIcon as LuFileText,
  FlagIcon as LuFlag,
  FolderOpenIcon as LuFolder,
  GlobeIcon as LuGlobe,
  GraduationCapIcon as LuGraduation,
  HouseIcon as LuHouse,
  IdCardIcon as LuIdCard,
  InboxIcon as LuInbox,
  KeyRoundIcon as LuKey,
  ListIcon as LuList,
  LockIcon as LuLock,
  LogOutIcon as LuLogOut,
  MenuIcon as LuMenu,
  MessageSquareIcon as LuMessage,
  PanelLeftIcon as LuPanelLeft,
  PaperclipIcon as LuPaperclip,
  PencilIcon as LuPencil,
  PlaneIcon as LuPlane,
  PlusIcon as LuPlus,
  RotateCcwIcon as LuRotate,
  SearchIcon as LuSearch,
  ShieldCheckIcon as LuShield,
  SlidersHorizontalIcon as LuSliders,
  TargetIcon as LuTarget,
  Trash2Icon as LuTrash,
  TrendingUpIcon as LuTrendingUp,
  UserIcon as LuUser,
  UsersIcon as LuUsers,
  WalletIcon as LuWallet,
  XIcon as LuX,
  type LucideIcon,
} from 'lucide-react';

/**
 * The CRM's icon set.
 *
 * Lucide, wrapped once so every icon in the app shares a size and stroke by
 * default and a caller only overrides what it needs. Aliasing here rather than
 * importing `lucide-react` at each call site keeps the vocabulary in one file:
 * swapping which glyph means "university" is a one-line change, and no page
 * has to know the upstream name.
 */

export interface IconProps {
  className?: string;
  strokeWidth?: number;
}

const icon = (Glyph: LucideIcon) =>
  function Icon({ className = 'w-5 h-5', strokeWidth = 1.6 }: IconProps) {
    return <Glyph className={className} strokeWidth={strokeWidth} aria-hidden />;
  };

/* ── Navigation ──────────────────────────────────────────────────────────── */

export const HomeIcon = icon(LuHouse);
export const UsersIcon = icon(LuUsers);
export const GraduationIcon = icon(LuGraduation);
export const ChatIcon = icon(LuMessage);
export const DocumentTextIcon = icon(LuFileText);
export const BookIcon = icon(LuBookOpen);
export const PassportIcon = icon(LuIdCard);
export const FolderIcon = icon(LuFolder);
export const WalletIcon = icon(LuWallet);
export const ChartIcon = icon(LuChart);
export const ShieldIcon = icon(LuShield);
export const KeyIcon = icon(LuKey);
export const UserIcon = icon(LuUser);
export const BellIcon = icon(LuBell);

/* ── Actions and states ──────────────────────────────────────────────────── */

export const SearchIcon = icon(LuSearch);
export const PlusIcon = icon(LuPlus);
export const CheckIcon = icon(LuCheck);
export const CloseIcon = icon(LuX);
export const ChevronRightIcon = icon(LuChevronRight);
export const ChevronDownIcon = icon(LuChevronDown);
export const ArrowLeftIcon = icon(LuArrowLeft);
export const MenuIcon = icon(LuMenu);
export const PanelLeftIcon = icon(LuPanelLeft);
export const SignOutIcon = icon(LuLogOut);
export const SlidersIcon = icon(LuSliders);
export const TrashIcon = icon(LuTrash);
export const PencilIcon = icon(LuPencil);
export const ExternalLinkIcon = icon(LuExternalLink);
export const DownloadIcon = icon(LuDownload);
export const InboxIcon = icon(LuInbox);
export const GlobeIcon = icon(LuGlobe);
export const BuildingIcon = icon(LuBuilding);
export const CalendarIcon = icon(LuCalendar);
export const ClockIcon = icon(LuClock);
export const CreditCardIcon = icon(LuCreditCard);
export const ClipboardIcon = icon(LuClipboard);
export const PaperclipIcon = icon(LuPaperclip);
export const PlaneIcon = icon(LuPlane);
export const FlagIcon = icon(LuFlag);
export const EyeIcon = icon(LuEye);
export const LockIcon = icon(LuLock);
export const TargetIcon = icon(LuTarget);
export const TrendingUpIcon = icon(LuTrendingUp);
export const RefundIcon = icon(LuRotate);
export const ListIcon = icon(LuList);

/* ── Notification types ──────────────────────────────────────────────────── */

export const NOTIFICATION_ICONS = {
  document: DocumentTextIcon,
  application: BuildingIcon,
  visa: PassportIcon,
  payment: CreditCardIcon,
  stage: FlagIcon,
  message: ChatIcon,
  general: BellIcon,
} as const;

export const notificationIcon = (type: string) =>
  NOTIFICATION_ICONS[type as keyof typeof NOTIFICATION_ICONS] ?? BellIcon;
