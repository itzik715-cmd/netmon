import { ReactNode } from 'react'

interface FormFieldProps {
  label: string
  children: ReactNode
  error?: string
  hint?: string
}

export default function FormField({ label, children, error, hint }: FormFieldProps) {
  return (
    <div className="form-field">
      <label className="form-label">{label}</label>
      {children}
      {error && <div className="form-field__error">{error}</div>}
      {hint && !error && <div className="form-field__hint">{hint}</div>}
    </div>
  )
}
