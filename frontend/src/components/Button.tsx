import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

type ButtonSize = 'sm' | 'md' | 'lg';
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: ButtonSize;
  variant?: ButtonVariant;
  icon?: ReactNode;
  children?: ReactNode;
}

const ICON_SIZE_CLASS: Record<ButtonSize, string> = {
  sm: styles.iconSm,
  md: styles.iconMd,
  lg: styles.iconLg,
};

const ICON_ONLY_SIZE_CLASS: Record<string, string> = {
  sm: styles.iconOnlySm,
  md: styles.iconOnlyMd,
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { size = 'md', variant = 'primary', icon, children, className, ...rest },
    ref
  ) {
    const isIconOnly = variant === 'icon';

    const classes = [
      styles.button,
      styles[size],
      isIconOnly ? styles.iconOnly : styles[variant],
      className,
    ]
      .filter(Boolean)
      .join(' ');

    const iconClass = isIconOnly
      ? ICON_ONLY_SIZE_CLASS[size] ?? ICON_ONLY_SIZE_CLASS.md
      : ICON_SIZE_CLASS[size];

    return (
      <button ref={ref} className={classes} type="button" {...rest}>
        {icon && <span className={iconClass}>{icon}</span>}
        {children}
      </button>
    );
  }
);
