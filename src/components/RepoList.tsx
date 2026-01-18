'use client';

import { useAppStore } from '@/stores/appStore';
import { deleteRepo } from '@/lib/api';

interface RepoListProps {
  onAddClick: () => void;
}

export function RepoList({ onAddClick }: RepoListProps) {
  const { repos, selectedRepoId, selectRepo, removeRepo } = useAppStore();

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteRepo(id);
    removeRepo(id);
  };

  return (
    <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <h1 className="text-xl font-bold">ChatML</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {repos.map((repo) => (
          <div
            key={repo.id}
            onClick={() => selectRepo(repo.id)}
            className={`p-3 rounded cursor-pointer flex justify-between items-center ${
              selectedRepoId === repo.id
                ? 'bg-blue-600'
                : 'hover:bg-gray-700'
            }`}
          >
            <div>
              <div className="font-medium">{repo.name}</div>
              <div className="text-xs text-gray-400">{repo.branch}</div>
            </div>
            <button
              onClick={(e) => handleDelete(repo.id, e)}
              className="text-gray-400 hover:text-red-400 text-xl"
            >
              x
            </button>
          </div>
        ))}
      </div>

      <div className="p-2 border-t border-gray-700">
        <button
          onClick={onAddClick}
          className="w-full p-2 bg-blue-600 hover:bg-blue-700 rounded"
        >
          + Add Repository
        </button>
      </div>
    </div>
  );
}
