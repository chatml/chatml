'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { listRepos, listAgents } from '@/lib/api';
import { RepoList } from '@/components/RepoList';
import { AddRepoModal } from '@/components/AddRepoModal';
import { AgentCard } from '@/components/AgentCard';
import { AgentSpawnForm } from '@/components/AgentSpawnForm';

export default function Home() {
  const [showAddRepo, setShowAddRepo] = useState(false);
  const { repos, selectedRepoId, agents, setRepos, setAgents } = useAppStore();

  useWebSocket();

  useEffect(() => {
    listRepos().then(setRepos).catch(console.error);
  }, [setRepos]);

  useEffect(() => {
    if (selectedRepoId) {
      listAgents(selectedRepoId).then(setAgents).catch(console.error);
    }
  }, [selectedRepoId, setAgents]);

  const selectedRepo = repos.find((r) => r.id === selectedRepoId);
  const repoAgents = agents.filter((a) => a.repoId === selectedRepoId);

  const refreshAgents = () => {
    if (selectedRepoId) {
      listAgents(selectedRepoId).then(setAgents).catch(console.error);
    }
  };

  return (
    <div className="flex h-screen">
      <RepoList onAddClick={() => setShowAddRepo(true)} />

      <div className="flex-1 p-6 overflow-y-auto">
        {selectedRepo ? (
          <>
            <div className="mb-6">
              <h2 className="text-2xl font-bold">{selectedRepo.name}</h2>
              <div className="text-gray-400">{selectedRepo.path}</div>
            </div>

            <AgentSpawnForm repoId={selectedRepoId!} onSpawn={refreshAgents} />

            {repoAgents.length === 0 ? (
              <div className="text-gray-500 text-center py-12">
                No agents running. Spawn one above!
              </div>
            ) : (
              repoAgents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onRefresh={refreshAgents}
                />
              ))
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            Select a repository to get started
          </div>
        )}
      </div>

      <AddRepoModal
        isOpen={showAddRepo}
        onClose={() => setShowAddRepo(false)}
      />
    </div>
  );
}
