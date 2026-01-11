import { invoke } from '@tauri-apps/api/core';
import { WorkerCard } from './WorkerCard';
import type { SessionState } from '../types';

interface WorkerListProps {
  sessions: SessionState[];
}

export function WorkerList({ sessions }: WorkerListProps) {
  // Separate stuck workers for prominent display
  const stuckSessions = sessions.filter((s) => s.status === 'stuck');
  const activeSessions = sessions.filter((s) => s.status !== 'stuck' && s.status !== 'complete' && s.status !== 'cancelled');
  const completedSessions = sessions.filter((s) => s.status === 'complete' || s.status === 'cancelled');

  const handleForward = async (sessionId: string, message: string) => {
    try {
      await invoke('forward_message', { sessionId, message });
    } catch (error) {
      console.error('Failed to forward message:', error);
    }
  };

  const handleCancel = async (sessionId: string) => {
    try {
      await invoke('cancel_session', { sessionId });
    } catch (error) {
      console.error('Failed to cancel session:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Stuck Workers - Prominent Alert */}
      {stuckSessions.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-red-400 mb-3 flex items-center gap-2">
            <span className="animate-pulse">!</span>
            Stuck Workers ({stuckSessions.length})
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {stuckSessions.map((session) => (
              <WorkerCard
                key={session.id}
                session={session}
                onForward={handleForward}
                onCancel={handleCancel}
                highlighted
              />
            ))}
          </div>
        </section>
      )}

      {/* Active Workers */}
      {activeSessions.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-dark-muted mb-3">
            Active Workers ({activeSessions.length})
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {activeSessions.map((session) => (
              <WorkerCard
                key={session.id}
                session={session}
                onForward={handleForward}
                onCancel={handleCancel}
              />
            ))}
          </div>
        </section>
      )}

      {/* Completed/Cancelled Workers */}
      {completedSessions.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-dark-muted mb-3">
            Completed ({completedSessions.length})
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {completedSessions.map((session) => (
              <WorkerCard
                key={session.id}
                session={session}
                onForward={handleForward}
                onCancel={handleCancel}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
