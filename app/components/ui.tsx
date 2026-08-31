import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

/* Shared presentational primitives. No application logic lives here. */

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-6">
      <p className="kicker">NACOS · UNIZIK</p>
      <h1 className="page-title mt-1">{title}</h1>
      {subtitle && <p className="mt-0.5 font-serif text-lg text-ink/80">{subtitle}</p>}
      {children && <div className="mt-3">{children}</div>}
    </header>
  );
}

export function SectionRule({ label }: { label?: string }) {
  if (!label) return <hr className="rule my-6" />;
  return (
    <div className="my-6 flex items-center gap-3">
      <hr className="rule flex-1" />
      <span className="kicker">{label}</span>
      <hr className="rule flex-1" />
    </div>
  );
}

type StatusKind = 'open' | 'scheduled' | 'draft' | 'closed';

const STATUS_STYLE: Record<StatusKind, { dot: string; text: string; label: string }> = {
  open: { dot: 'bg-accent', text: 'text-accent', label: 'Open' },
  scheduled: { dot: 'bg-gold', text: 'text-gold', label: 'Scheduled' },
  draft: { dot: 'bg-ink/40', text: 'text-ink/60', label: 'Draft' },
  closed: { dot: 'bg-danger', text: 'text-danger', label: 'Closed' },
};

export function StatusBadge({ status, detail }: { status: string; detail?: string }) {
  const s = STATUS_STYLE[(status as StatusKind) in STATUS_STYLE ? (status as StatusKind) : 'draft'];
  return (
    <span className={`status-badge ${s.text}`}>
      <span className={`status-dot ${s.dot}`} aria-hidden="true" />
      <span>
        {s.label}
        {detail ? ` · ${detail}` : ''}
      </span>
    </span>
  );
}

export function MessageBlock({
  variant = 'info',
  title,
  children,
}: {
  variant?: 'error' | 'warn' | 'info';
  title?: string;
  children?: ReactNode;
}) {
  const cls = variant === 'error' ? 'msg-error' : variant === 'warn' ? 'msg-warn' : 'msg-info';
  return (
    <div
      className={cls}
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
    >
      {title && <p className="msg-title">{title}</p>}
      {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  block?: boolean;
};

export function Button({
  variant = 'primary',
  loading = false,
  block = false,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const base =
    variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : 'btn-secondary';
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${base} ${block ? 'btn-block' : ''} ${className}`}
    >
      {loading && <span className="spinner" aria-hidden="true" />}
      <span>{children}</span>
    </button>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-4">
      <label htmlFor={htmlFor} className="field-label">
        {label}
      </label>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function TextField({
  label,
  hint,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <input id={id} className="field-input" {...props} />
    </Field>
  );
}

export function CandidateOption({
  name,
  value,
  checked,
  onChange,
  candidate,
}: {
  name: string;
  value: number;
  checked: boolean;
  onChange: () => void;
  candidate: string;
}) {
  return (
    <label className="candidate-option">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
      />
      <span>{candidate}</span>
    </label>
  );
}
