import { X } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import s from './Modal.module.scss';

interface ModalProps {
  title: string;
  onClose?: () => void;
  closable?: boolean;
  children: ReactNode;
}

export const Modal = ({ title, onClose, closable = true, children }: ModalProps) => {
  const { t } = useTranslation();

  useEffect(() => {
    if (!closable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closable, onClose]);

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!closable) return;
    if (e.target === e.currentTarget) onClose?.();
  };

  const handleBackdropKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!closable) return;
    if (e.key === 'Enter' || e.key === ' ') onClose?.();
  };

  return createPortal(
    <div
      className={s.backdrop}
      onClick={handleBackdrop}
      onKeyDown={handleBackdropKey}
      role="presentation"
    >
      <dialog className={s.card} open aria-label={title}>
        <header className={s.head}>
          <h2 className={s.title}>{title}</h2>
          {closable && (
            <button
              type="button"
              className={s.close}
              onClick={onClose}
              aria-label={t('common.close')}
            >
              <X size={18} />
            </button>
          )}
        </header>
        <div className={s.body}>{children}</div>
      </dialog>
    </div>,
    document.body,
  );
};
