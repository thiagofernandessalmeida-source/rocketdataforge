import React from "react";
import { X, Zap, Circle } from "lucide-react";
import { jobStore } from "../../store/jobStore";
import { useJobStore } from "../../store/useJobStore";

interface JobTabBarProps {
  onActivateTab: (jobId: string) => void;
}

export const JobTabBar: React.FC<JobTabBarProps> = ({ onActivateTab }) => {
  const state = useJobStore();

  if (state.openTabIds.length === 0) {
    return (
      <div className="tab-bar tab-bar-empty">
        <span className="tab-bar-hint">
          Abra um job no Repositório para começar ↖
        </span>
      </div>
    );
  }

  return (
    <div className="tab-bar" id="job-tab-bar">
      <div className="tab-bar-inner">
        {state.openTabIds.map((jobId) => {
          const job = state.jobs.find((j) => j.id === jobId);
          if (!job) return null;
          const isActive = state.activeTabId === jobId;
          const isDirty = job.status === "draft";

          return (
            <div
              key={jobId}
              className={`job-tab ${isActive ? "active" : ""}`}
              onClick={() => {
                jobStore.setActiveTab(jobId);
                onActivateTab(jobId);
              }}
              title={job.name}
            >
              <Zap size={12} className="job-tab-icon" />
              <span className="job-tab-name">{job.name}</span>
              {isDirty && (
                <Circle size={7} className="job-tab-dirty" fill="currentColor" />
              )}
              <button
                className="job-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  jobStore.closeTab(jobId);
                }}
                title="Fechar aba"
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
