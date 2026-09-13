import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { MicroSaaSProject } from '../types';

interface DeleteProjectModalProps {
  project: MicroSaaSProject;
  isOpen: boolean;
  onClose: () => void;
  onConfirmDelete: (projectId: string) => void;
}

export const DeleteProjectModal: React.FC<DeleteProjectModalProps> = ({
  project,
  isOpen,
  onClose,
  onConfirmDelete,
}) => {
  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirmDelete(project.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#F7F6F2] rounded-2xl border border-stone-300 shadow-2xl max-w-md w-full overflow-hidden text-stone-800 animate-fadeIn">
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="shrink-0 h-10 w-10 rounded-xl bg-rose-100 border border-rose-200 flex items-center justify-center text-rose-700">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-stone-900 text-base">
                確定要刪除「{project.name}」嗎？
              </h3>
              <p className="text-sm text-stone-600 mt-1.5 leading-relaxed">
                這個動作無法復原，這個專案在儀表板上的所有紀錄（進度、AI 摘要、活動歷史）都會被刪除。如果這是真實的
                GitHub 專案，不會影響你在 GitHub 上的程式碼，只是從這個儀表板上移除。
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white px-6 py-4 border-t border-stone-200 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 text-sm font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition-colors cursor-pointer"
          >
            確定刪除
          </button>
        </div>
      </div>
    </div>
  );
};
