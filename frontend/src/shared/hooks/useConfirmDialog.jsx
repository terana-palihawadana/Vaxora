import { useCallback, useRef, useState } from 'react';
import ConfirmModal from '../components/ConfirmModal';

/**
 * Promise-based confirm matching mobile `confirmAction`.
 * Usage: const [confirm, confirmDialog] = useConfirmDialog();
 *        if (!(await confirm({ title, message, destructive: true }))) return;
 *        // …then render {confirmDialog} once in the component tree
 */
export default function useConfirmDialog() {
  const [state, setState] = useState(null);
  const resolveRef = useRef(null);

  const finish = useCallback((result) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setState(null);
    resolve?.(result);
  }, []);

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({
        title: options.title || 'Confirm?',
        message: options.message || '',
        cancelLabel: options.cancelLabel || 'Cancel',
        confirmLabel: options.confirmLabel || 'Confirm',
        destructive: Boolean(options.destructive),
      });
    });
  }, []);

  const confirmDialog = (
    <ConfirmModal
      isOpen={Boolean(state)}
      title={state?.title}
      message={state?.message}
      cancelLabel={state?.cancelLabel}
      confirmLabel={state?.confirmLabel}
      destructive={state?.destructive}
      onCancel={() => finish(false)}
      onConfirm={() => finish(true)}
    />
  );

  return [confirm, confirmDialog];
}
