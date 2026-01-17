interface SoundToggleProps {
  enabled: boolean;
  onToggle: () => void;
}

function SoundToggle({ enabled, onToggle }: SoundToggleProps) {
  return (
    <button
      onClick={onToggle}
      className={`p-2 rounded transition-colors ${
        enabled
          ? 'text-green-400 hover:text-green-300 hover:bg-ppds-surface'
          : 'text-gray-500 hover:text-gray-400 hover:bg-ppds-surface'
      }`}
      title={enabled ? 'Sounds enabled (click to mute)' : 'Sounds disabled (click to unmute)'}
    >
      {enabled ? (
        // Sound on icon
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.784L4.586 14H2a1 1 0 01-1-1V7a1 1 0 011-1h2.586l3.797-2.784a1 1 0 011 .076zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" />
        </svg>
      ) : (
        // Sound off icon
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.784L4.586 14H2a1 1 0 01-1-1V7a1 1 0 011-1h2.586l3.797-2.784a1 1 0 011 .076zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" />
        </svg>
      )}
    </button>
  );
}

export default SoundToggle;
