import { useEffect, useState } from "react";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: React.ReactNode;
  /** Word the user must type to enable confirm. Default: "confirm" */
  confirmWord?: string;
  /** Confirm button label. Default: "Confirm" */
  actionLabel?: string;
  /** When true, button is destructive-styled. Default: true */
  destructive?: boolean;
  onConfirm: () => void;
}

export function ConfirmActionDialog({
  open,
  onOpenChange,
  title = "Are you sure?",
  description,
  confirmWord = "confirm",
  actionLabel = "Confirm",
  destructive = true,
  onConfirm,
}: Props) {
  const [text, setText] = useState("");

  useEffect(() => {
    if (!open) setText("");
  }, [open]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {description || <>This action cannot be undone. Type <strong>{confirmWord}</strong> to proceed.</>}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          autoFocus
          placeholder={`Type "${confirmWord}" to proceed`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text === confirmWord) {
              onConfirm();
              onOpenChange(false);
            }
          }}
          className="mt-2"
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={text !== confirmWord}
            className={destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
            onClick={() => { onConfirm(); onOpenChange(false); }}
          >
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
