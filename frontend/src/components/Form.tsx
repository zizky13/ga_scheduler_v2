import {
  forwardRef,
  useState,
  useRef,
  useEffect,
  useCallback,
} from 'react';
import type {
  InputHTMLAttributes,
  ReactNode,
  ChangeEvent,
} from 'react';
import { AlertCircle, ChevronDown, ChevronUp, Check, X, Search } from 'lucide-react';
import styles from './Form.module.css';

/* ══════════════════════════════════════════
   FormField — wrapper with label / helper / error
   ══════════════════════════════════════════ */

interface FormFieldProps {
  label?: string;
  htmlFor?: string;
  required?: boolean;
  helperText?: string;
  error?: string;
  children: ReactNode;
}

export function FormField({
  label,
  htmlFor,
  required,
  helperText,
  error,
  children,
}: FormFieldProps) {
  return (
    <div className={styles.field}>
      {label && (
        <label className={styles.label} htmlFor={htmlFor}>
          {label}
          {required && <span className={styles.required}>*</span>}
        </label>
      )}
      {children}
      {error ? (
        <div className={styles.errorMessage}>
          <AlertCircle className={styles.errorIcon} />
          {error}
        </div>
      ) : helperText ? (
        <div className={styles.helperText}>{helperText}</div>
      ) : null}
    </div>
  );
}

/* ══════════════════════════════════════════
   TextInput
   ══════════════════════════════════════════ */

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ label, helperText, error, required, id, className, ...rest }, ref) {
    const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    return (
      <FormField label={label} htmlFor={inputId} required={required} helperText={helperText} error={error}>
        <input
          ref={ref}
          id={inputId}
          className={`${styles.input} ${error ? styles.inputError : ''} ${className ?? ''}`}
          required={required}
          {...rest}
        />
      </FormField>
    );
  }
);

/* ══════════════════════════════════════════
   Select
   ══════════════════════════════════════════ */

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label?: string;
  helperText?: string;
  error?: string;
  required?: boolean;
  placeholder?: string;
  options: SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  id?: string;
}

export function Select({
  label,
  helperText,
  error,
  required,
  placeholder = 'Select…',
  options,
  value,
  onChange,
  disabled,
  id,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputId = id ?? (label ? `select-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

  const selected = options.find((o) => o.value === value);

  const handleClose = useCallback(() => setOpen(false), []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        handleClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [handleClose]);

  return (
    <FormField label={label} htmlFor={inputId} required={required} helperText={helperText} error={error}>
      <div className={styles.selectWrapper} ref={wrapperRef}>
        <button
          id={inputId}
          type="button"
          className={`${styles.selectTrigger} ${error ? styles.selectTriggerError : ''}`}
          onClick={() => !disabled && setOpen((p) => !p)}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          {selected ? (
            selected.label
          ) : (
            <span className={styles.selectPlaceholder}>{placeholder}</span>
          )}
        </button>
        <ChevronDown
          size={16}
          className={`${styles.selectChevron} ${open ? styles.selectChevronOpen : ''}`}
        />

        {open && (
          <div className={styles.selectDropdown} role="listbox">
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                className={`${styles.selectOption} ${opt.value === value ? styles.selectOptionSelected : ''}`}
                onClick={() => {
                  onChange?.(opt.value);
                  setOpen(false);
                }}
              >
                {opt.label}
                {opt.value === value && <Check className={styles.selectCheckIcon} />}
              </button>
            ))}
          </div>
        )}
      </div>
    </FormField>
  );
}

/* ══════════════════════════════════════════
   MultiSelect
   ══════════════════════════════════════════ */

interface MultiSelectProps {
  label?: string;
  helperText?: string;
  error?: string;
  required?: boolean;
  placeholder?: string;
  options: SelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  id?: string;
}

export function MultiSelect({
  label,
  helperText,
  error,
  required,
  placeholder = 'Select…',
  options,
  value,
  onChange,
  disabled,
  id,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const inputId = id ?? (label ? `multiselect-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

  const handleClose = useCallback(() => {
    setOpen(false);
    setSearch('');
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        handleClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [handleClose]);

  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open]);

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(search.toLowerCase()),
  );

  function toggleOption(optValue: string) {
    if (value.includes(optValue)) {
      onChange(value.filter((v) => v !== optValue));
    } else {
      onChange([...value, optValue]);
    }
  }

  function removeTag(optValue: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!disabled) {
      onChange(value.filter((v) => v !== optValue));
    }
  }

  const selectedOptions = value
    .map((v) => options.find((o) => o.value === v))
    .filter(Boolean) as SelectOption[];

  return (
    <FormField label={label} htmlFor={inputId} required={required} helperText={helperText} error={error}>
      <div className={styles.multiSelectWrapper} ref={wrapperRef}>
        <div
          id={inputId}
          className={`${styles.multiSelectTrigger} ${error ? styles.multiSelectTriggerError : ''} ${disabled ? styles.multiSelectTriggerDisabled : ''} ${open ? styles.multiSelectTriggerFocused : ''}`}
          onClick={() => !disabled && setOpen((p) => !p)}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          tabIndex={disabled ? -1 : 0}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setOpen((p) => !p);
            } else if (e.key === 'Escape') {
              handleClose();
            }
          }}
        >
          {selectedOptions.length > 0 ? (
            <div className={styles.multiSelectTags}>
              {selectedOptions.map((opt) => (
                <span key={opt.value} className={styles.multiSelectTag}>
                  <span className={styles.multiSelectTagLabel}>{opt.label}</span>
                  <button
                    type="button"
                    className={styles.multiSelectTagRemove}
                    onClick={(e) => removeTag(opt.value, e)}
                    aria-label={`Remove ${opt.label}`}
                    tabIndex={-1}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <span className={styles.multiSelectPlaceholder}>{placeholder}</span>
          )}
          <ChevronDown
            size={16}
            className={`${styles.multiSelectChevron} ${open ? styles.multiSelectChevronOpen : ''}`}
          />
        </div>

        {open && (
          <div className={styles.multiSelectDropdown} role="listbox" aria-multiselectable="true">
            <div className={styles.multiSelectSearchWrapper}>
              <Search size={14} className={styles.multiSelectSearchIcon} />
              <input
                ref={searchRef}
                type="text"
                className={styles.multiSelectSearchInput}
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    handleClose();
                  }
                }}
              />
            </div>
            <div className={styles.multiSelectOptionsList}>
              {filteredOptions.length === 0 ? (
                <div className={styles.multiSelectNoResults}>No results found</div>
              ) : (
                filteredOptions.map((opt) => {
                  const isSelected = value.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`${styles.multiSelectOption} ${isSelected ? styles.multiSelectOptionSelected : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleOption(opt.value);
                      }}
                    >
                      <span className={styles.multiSelectCheckboxBox}>
                        {isSelected && <Check size={12} className={styles.multiSelectCheckIcon} />}
                      </span>
                      <span className={styles.multiSelectOptionLabel}>{opt.label}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </FormField>
  );
}

/* ══════════════════════════════════════════
   NumberInput
   ══════════════════════════════════════════ */

interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  label?: string;
  helperText?: string;
  error?: string;
  value?: number;
  onChange?: (value: number) => void;
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  function NumberInput({ label, helperText, error, required, id, value, onChange, min, max, step = 1, disabled, className, ...rest }, ref) {
    const inputId = id ?? (label ? `number-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);
    const numStep = Number(step);
    const numMin = min != null ? Number(min) : undefined;
    const numMax = max != null ? Number(max) : undefined;

    function clamp(v: number) {
      let clamped = v;
      if (numMin != null) clamped = Math.max(numMin, clamped);
      if (numMax != null) clamped = Math.min(numMax, clamped);
      return clamped;
    }

    function handleStep(dir: 1 | -1) {
      const next = clamp((value ?? 0) + dir * numStep);
      onChange?.(next);
    }

    function handleChange(e: ChangeEvent<HTMLInputElement>) {
      const raw = e.target.value;
      if (raw === '') return;
      onChange?.(Number(raw));
    }

    return (
      <FormField label={label} htmlFor={inputId} required={required} helperText={helperText} error={error}>
        <div className={styles.numberWrapper}>
          <input
            ref={ref}
            id={inputId}
            type="number"
            className={`${styles.input} ${error ? styles.inputError : ''} ${className ?? ''}`}
            value={value ?? ''}
            onChange={handleChange}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            required={required}
            {...rest}
          />
          {!disabled && (
            <div className={styles.numberSteppers}>
              <button
                type="button"
                className={styles.numberStep}
                onClick={() => handleStep(1)}
                tabIndex={-1}
                aria-label="Increment"
              >
                <ChevronUp size={16} />
              </button>
              <button
                type="button"
                className={styles.numberStep}
                onClick={() => handleStep(-1)}
                tabIndex={-1}
                aria-label="Decrement"
              >
                <ChevronDown size={16} />
              </button>
            </div>
          )}
        </div>
      </FormField>
    );
  }
);

/* ══════════════════════════════════════════
   Checkbox
   ══════════════════════════════════════════ */

interface CheckboxProps {
  label?: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}

export function Checkbox({ label, checked, onChange, disabled, id }: CheckboxProps) {
  const inputId = id ?? (label ? `checkbox-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

  return (
    <label className={styles.checkboxLabel} data-disabled={disabled}>
      <input
        id={inputId}
        type="checkbox"
        className={styles.checkboxInput}
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        disabled={disabled}
      />
      <span className={styles.checkboxBox}>
        <Check className={styles.checkboxCheck} />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}

/* ══════════════════════════════════════════
   Radio
   ══════════════════════════════════════════ */

interface RadioProps {
  label?: string;
  name: string;
  value: string;
  checked?: boolean;
  onChange?: (value: string) => void;
  disabled?: boolean;
  id?: string;
}

export function Radio({ label, name, value, checked, onChange, disabled, id }: RadioProps) {
  const inputId = id ?? `radio-${name}-${value}`;

  return (
    <label className={styles.radioLabel} data-disabled={disabled}>
      <input
        id={inputId}
        type="radio"
        name={name}
        value={value}
        className={styles.radioInput}
        checked={checked}
        onChange={() => onChange?.(value)}
        disabled={disabled}
      />
      <span className={styles.radioCircle}>
        <span className={styles.radioDot} />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}

/* ══════════════════════════════════════════
   Toggle / Switch
   ══════════════════════════════════════════ */

interface ToggleProps {
  label?: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}

export function Toggle({ label, checked, onChange, disabled, id }: ToggleProps) {
  const inputId = id ?? (label ? `toggle-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

  return (
    <label className={styles.toggleLabel} data-disabled={disabled}>
      <input
        id={inputId}
        type="checkbox"
        className={styles.toggleInput}
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        disabled={disabled}
      />
      <span className={styles.toggleTrack}>
        <span className={styles.toggleThumb} />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}

/* ══════════════════════════════════════════
   Form layout helpers
   ══════════════════════════════════════════ */

export function FormGrid({ children }: { children: ReactNode }) {
  return <div className={styles.formGrid}>{children}</div>;
}

export function FormRow({ children }: { children: ReactNode }) {
  return <div className={styles.formRow}>{children}</div>;
}

export function FormSection({ children }: { children: ReactNode }) {
  return <div className={styles.formSection}>{children}</div>;
}

export function FormActions({ children }: { children: ReactNode }) {
  return <div className={styles.formActions}>{children}</div>;
}
