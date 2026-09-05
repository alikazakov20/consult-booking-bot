interface TelegramMainButton {
  text: string;
  isVisible: boolean;
  isActive: boolean;
  show(): void;
  hide(): void;
  setText(text: string): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
  showProgress(leaveActive: boolean): void;
  hideProgress(): void;
  setParams(params: { color?: string; text_color?: string }): void;
}

interface TelegramBackButton {
  isVisible: boolean;
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string; last_name?: string; username?: string } };
  themeParams: Record<string, string>;
  colorScheme: 'light' | 'dark';
  MainButton: TelegramMainButton;
  BackButton: TelegramBackButton;
  ready(): void;
  expand(): void;
  close(): void;
  showAlert(message: string): void;
  showConfirm(message: string, cb: (ok: boolean) => void): void;
  HapticFeedback?: { notificationOccurred(type: 'success' | 'error' | 'warning'): void };
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

export function getInitData(): string {
  return getTelegramWebApp()?.initData ?? '';
}
