import { XMarkIcon } from "@heroicons/react/24/solid";

type ModalCloseButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
  className?: string;
};

export function ModalCloseButton({
  onClick,
  disabled = false,
  label = "Close",
  className = "",
}: ModalCloseButtonProps) {
  return (
    <button
      type="button"
      className={`button-secondary dashboard-icon-button modal-close-button ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <XMarkIcon aria-hidden="true" />
    </button>
  );
}
