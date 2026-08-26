'use client';

import { useId, useState } from 'react';

type Props = {
  label: string;
  type?: 'text' | 'email' | 'password' | 'tel';
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
};

export function Field({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  autoComplete,
  autoFocus,
  required,
  disabled,
  hint,
}: Props) {
  const id = useId();
  const [reveal, setReveal] = useState(false);
  const isPassword = type === 'password';

  return (
    <div className="group">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <label htmlFor={id} className="text-[13px] font-medium text-t2">
          {label}
        </label>
        {hint && <span className="text-[11px] text-t2 tabular-nums">{hint}</span>}
      </div>

      <div className="relative">
        <input
          id={id}
          type={isPassword && reveal ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required={required}
          disabled={disabled}
          className={[
            'w-full min-h-[44px] rounded-xl bg-base border border-line px-3.5 py-3 text-[15px] text-t1',
            'placeholder:text-t2 transition-[border-color,box-shadow] duration-150',
            'hover:border-t3',
            'focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/25',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            isPassword ? 'pr-11' : '',
          ].join(' ')}
        />

        {isPassword && (
          <button
            type="button"
            onClick={() => setReveal(!reveal)}
            aria-label={reveal ? 'Hide password' : 'Show password'}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 grid place-items-center w-8 h-8 rounded-md text-t2 hover:text-t1 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors duration-150"
          >
            {reveal ? (
              <svg viewBox="0 0 20 20" aria-hidden className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M3 3l14 14" />
                <path d="M8.4 8.5a2.2 2.2 0 003.1 3.1" />
                <path d="M6.1 6.3C4.3 7.4 2.9 9 2 10c1.6 2.8 4.5 5 8 5 1.3 0 2.5-.3 3.6-.8" />
                <path d="M16.2 12.7C17.1 11.9 17.6 11 18 10c-1.6-2.8-4.5-5-8-5-.7 0-1.3.1-1.9.2" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" aria-hidden className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 10c1.6-2.8 4.5-5 8-5s6.4 2.2 8 5c-1.6 2.8-4.5 5-8 5s-6.4-2.2-8-5z" />
                <circle cx="10" cy="10" r="2.2" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export function SubmitButton({
  loading,
  children,
  loadingLabel,
}: {
  loading: boolean;
  children: React.ReactNode;
  loadingLabel: string;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full min-h-[44px] rounded-full bg-accent px-6 py-3 text-[15px] font-semibold text-white transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.97] disabled:opacity-55 disabled:cursor-not-allowed disabled:active:scale-100 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-base"
    >
      <span className="flex items-center justify-center gap-2.5">
        {loading && (
          <svg viewBox="0 0 24 24" aria-hidden className="w-4 h-4 motion-safe:animate-spin" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.3" />
            <path d="M12 3a9 9 0 019 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        )}
        {loading ? loadingLabel : children}
      </span>
    </button>
  );
}
