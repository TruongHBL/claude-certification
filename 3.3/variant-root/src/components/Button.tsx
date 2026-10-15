// Component nút (rút gọn, không dùng JSX để codebase mẫu typecheck không cần cấu hình React).
export interface ButtonProps {
  label: string;
  disabled?: boolean;
}

export function renderButton(props: ButtonProps): string {
  return `<button${props.disabled ? " disabled" : ""}>${props.label}</button>`;
}
