import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore, getBranchPrefix } from '../settingsStore';

describe('settingsStore', () => {
  describe('showThinkingBlocks', () => {
    beforeEach(() => {
      useSettingsStore.setState({ showThinkingBlocks: true });
    });

    it('should have a default value of true', () => {
      const { showThinkingBlocks } = useSettingsStore.getState();
      expect(showThinkingBlocks).toBe(true);
    });

    it('should update showThinkingBlocks when setShowThinkingBlocks is called', () => {
      const { setShowThinkingBlocks } = useSettingsStore.getState();
      setShowThinkingBlocks(false);
      expect(useSettingsStore.getState().showThinkingBlocks).toBe(false);
    });

    it('should not affect other settings when setShowThinkingBlocks is called', () => {
      const initialState = useSettingsStore.getState();
      const { setShowThinkingBlocks } = useSettingsStore.getState();
      setShowThinkingBlocks(false);
      const newState = useSettingsStore.getState();
      
      expect(newState.reviewModel).toBe(initialState.reviewModel);
      expect(newState.defaultPlanMode).toBe(initialState.defaultPlanMode);
      expect(newState.soundEffectType).toBe(initialState.soundEffectType);
    });
  });

  describe('reviewModel', () => {
    beforeEach(() => {
      useSettingsStore.setState({ reviewModel: 'opus-4.5' });
    });

    it('should have a default value of opus-4.5', () => {
      const { reviewModel } = useSettingsStore.getState();
      expect(reviewModel).toBe('opus-4.5');
    });

    it('should update reviewModel when setReviewModel is called', () => {
      const { setReviewModel } = useSettingsStore.getState();
      setReviewModel('sonnet-4.5');
      expect(useSettingsStore.getState().reviewModel).toBe('sonnet-4.5');
    });

    it('should not affect other settings when setReviewModel is called', () => {
      const initialState = useSettingsStore.getState();
      const { setReviewModel } = useSettingsStore.getState();
      setReviewModel('sonnet-4.5');
      const newState = useSettingsStore.getState();
      
      expect(newState.showThinkingBlocks).toBe(initialState.showThinkingBlocks);
      expect(newState.defaultPlanMode).toBe(initialState.defaultPlanMode);
      expect(newState.soundEffectType).toBe(initialState.soundEffectType);
    });
  });

  describe('defaultPlanMode', () => {
    beforeEach(() => {
      useSettingsStore.setState({ defaultPlanMode: false });
    });

    it('should have a default value of false', () => {
      const { defaultPlanMode } = useSettingsStore.getState();
      expect(defaultPlanMode).toBe(false);
    });

    it('should update defaultPlanMode when setDefaultPlanMode is called', () => {
      const { setDefaultPlanMode } = useSettingsStore.getState();
      setDefaultPlanMode(true);
      expect(useSettingsStore.getState().defaultPlanMode).toBe(true);
    });

    it('should not affect other settings when setDefaultPlanMode is called', () => {
      const initialState = useSettingsStore.getState();
      const { setDefaultPlanMode } = useSettingsStore.getState();
      setDefaultPlanMode(true);
      const newState = useSettingsStore.getState();
      
      expect(newState.showThinkingBlocks).toBe(initialState.showThinkingBlocks);
      expect(newState.reviewModel).toBe(initialState.reviewModel);
      expect(newState.soundEffectType).toBe(initialState.soundEffectType);
    });
  });

  describe('soundEffectType', () => {
    beforeEach(() => {
      useSettingsStore.setState({ soundEffectType: 'chime' });
    });

    it('should have a default value of chime', () => {
      const { soundEffectType } = useSettingsStore.getState();
      expect(soundEffectType).toBe('chime');
    });

    it('should update soundEffectType when setSoundEffectType is called', () => {
      const { setSoundEffectType } = useSettingsStore.getState();
      setSoundEffectType('beep');
      expect(useSettingsStore.getState().soundEffectType).toBe('beep');
    });

    it('should not affect other settings when setSoundEffectType is called', () => {
      const initialState = useSettingsStore.getState();
      const { setSoundEffectType } = useSettingsStore.getState();
      setSoundEffectType('beep');
      const newState = useSettingsStore.getState();
      
      expect(newState.showThinkingBlocks).toBe(initialState.showThinkingBlocks);
      expect(newState.reviewModel).toBe(initialState.reviewModel);
      expect(newState.defaultPlanMode).toBe(initialState.defaultPlanMode);
    });
  });

  describe('autoConvertLongText', () => {
    beforeEach(() => {
      useSettingsStore.setState({ autoConvertLongText: true });
    });

    it('should have a default value of true', () => {
      const { autoConvertLongText } = useSettingsStore.getState();
      expect(autoConvertLongText).toBe(true);
    });

    it('should update autoConvertLongText when setAutoConvertLongText is called', () => {
      const { setAutoConvertLongText } = useSettingsStore.getState();
      setAutoConvertLongText(false);
      expect(useSettingsStore.getState().autoConvertLongText).toBe(false);
    });

    it('should not affect other settings when setAutoConvertLongText is called', () => {
      const initialState = useSettingsStore.getState();
      const { setAutoConvertLongText } = useSettingsStore.getState();
      setAutoConvertLongText(false);
      const newState = useSettingsStore.getState();
      
      expect(newState.showThinkingBlocks).toBe(initialState.showThinkingBlocks);
      expect(newState.reviewModel).toBe(initialState.reviewModel);
      expect(newState.soundEffectType).toBe(initialState.soundEffectType);
    });
  });

  describe('showChatCost', () => {
    beforeEach(() => {
      useSettingsStore.setState({ showChatCost: true });
    });

    it('should have a default value of true', () => {
      const { showChatCost } = useSettingsStore.getState();
      expect(showChatCost).toBe(true);
    });

    it('should update showChatCost when setShowChatCost is called', () => {
      const { setShowChatCost } = useSettingsStore.getState();
      setShowChatCost(false);
      expect(useSettingsStore.getState().showChatCost).toBe(false);
    });

    it('should not affect other settings when setShowChatCost is called', () => {
      const initialState = useSettingsStore.getState();
      const { setShowChatCost } = useSettingsStore.getState();
      setShowChatCost(false);
      const newState = useSettingsStore.getState();
      
      expect(newState.showThinkingBlocks).toBe(initialState.showThinkingBlocks);
      expect(newState.reviewModel).toBe(initialState.reviewModel);
      expect(newState.autoConvertLongText).toBe(initialState.autoConvertLongText);
    });
  });

  describe('fontSize', () => {
    beforeEach(() => {
      useSettingsStore.setState({ fontSize: 'medium' });
    });

    it('should have a default value of medium', () => {
      const { fontSize } = useSettingsStore.getState();
      expect(fontSize).toBe('medium');
    });

    it('should update fontSize when setFontSize is called', () => {
      const { setFontSize } = useSettingsStore.getState();
      setFontSize('large');
      expect(useSettingsStore.getState().fontSize).toBe('large');
    });

    it('should handle all valid fontSize values', () => {
      const { setFontSize } = useSettingsStore.getState();
      
      setFontSize('small');
      expect(useSettingsStore.getState().fontSize).toBe('small');
      
      setFontSize('medium');
      expect(useSettingsStore.getState().fontSize).toBe('medium');
      
      setFontSize('large');
      expect(useSettingsStore.getState().fontSize).toBe('large');
    });

    it('should not affect other settings when setFontSize is called', () => {
      const initialState = useSettingsStore.getState();
      const { setFontSize } = useSettingsStore.getState();
      setFontSize('large');
      const newState = useSettingsStore.getState();
      
      expect(newState.showThinkingBlocks).toBe(initialState.showThinkingBlocks);
      expect(newState.reviewModel).toBe(initialState.reviewModel);
      expect(newState.showChatCost).toBe(initialState.showChatCost);
    });
  });

  describe('branchPrefixType', () => {
    beforeEach(() => {
      useSettingsStore.setState({ branchPrefixType: 'github' });
    });

    it('should have a default value of github', () => {
      const { branchPrefixType } = useSettingsStore.getState();
      expect(branchPrefixType).toBe('github');
    });

    it('should update branchPrefixType when setBranchPrefixType is called', () => {
      const { setBranchPrefixType } = useSettingsStore.getState();
      setBranchPrefixType('custom');
      expect(useSettingsStore.getState().branchPrefixType).toBe('custom');
    });

    it('should handle all valid branchPrefixType values', () => {
      const { setBranchPrefixType } = useSettingsStore.getState();
      
      setBranchPrefixType('github');
      expect(useSettingsStore.getState().branchPrefixType).toBe('github');
      
      setBranchPrefixType('custom');
      expect(useSettingsStore.getState().branchPrefixType).toBe('custom');
      
      setBranchPrefixType('none');
      expect(useSettingsStore.getState().branchPrefixType).toBe('none');
    });

    it('should not affect other settings when setBranchPrefixType is called', () => {
      const initialState = useSettingsStore.getState();
      const { setBranchPrefixType } = useSettingsStore.getState();
      setBranchPrefixType('custom');
      const newState = useSettingsStore.getState();
      
      expect(newState.showThinkingBlocks).toBe(initialState.showThinkingBlocks);
      expect(newState.reviewModel).toBe(initialState.reviewModel);
      expect(newState.fontSize).toBe(initialState.fontSize);
    });
  });

  describe('branchPrefixCustom', () => {
    beforeEach(() => {
      useSettingsStore.setState({ branchPrefixCustom: '' });
    });

    it('should have a default value of empty string', () => {
      const { branchPrefixCustom } = useSettingsStore.getState();
      expect(branchPrefixCustom).toBe('');
    });

    it('should update branchPrefixCustom when setBranchPrefixCustom is called', () => {
      const { setBranchPrefixCustom } = useSettingsStore.getState();
      setBranchPrefixCustom('my-custom-prefix');
      expect(useSettingsStore.getState().branchPrefixCustom).toBe('my-custom-prefix');
    });

    it('should not affect other settings when setBranchPrefixCustom is called', () => {
      const initialState = useSettingsStore.getState();
      const { setBranchPrefixCustom } = useSettingsStore.getState();
      setBranchPrefixCustom('my-custom-prefix');
      const newState = useSettingsStore.getState();
      
      expect(newState.showThinkingBlocks).toBe(initialState.showThinkingBlocks);
      expect(newState.reviewModel).toBe(initialState.reviewModel);
      expect(newState.branchPrefixType).toBe(initialState.branchPrefixType);
    });
  });

  describe('deleteBranchOnArchive', () => {
    beforeEach(() => {
      useSettingsStore.setState({ deleteBranchOnArchive: false });
    });

    it('should have a default value of false', () => {
      const { deleteBranchOnArchive } = useSettingsStore.getState();
      expect(deleteBranchOnArchive).toBe(false);
    });

    it('should update deleteBranchOnArchive when setDeleteBranchOnArchive is called', () => {
      const { setDeleteBranchOnArchive } = useSettingsStore.getState();
      setDeleteBranchOnArchive(true);
      expect(useSettingsStore.getState().deleteBranchOnArchive).toBe(true);
    });

    it('should not affect other settings when setDeleteBranchOnArchive is called', () => {
      const initialState = useSettingsStore.getState();
      const { setDeleteBranchOnArchive } = useSettingsStore.getState();
      setDeleteBranchOnArchive(true);
      const newState = useSettingsStore.getState();
      
      expect(newState.showThinkingBlocks).toBe(initialState.showThinkingBlocks);
      expect(newState.reviewModel).toBe(initialState.reviewModel);
      expect(newState.branchPrefixCustom).toBe(initialState.branchPrefixCustom);
    });
  });

  describe('archiveOnMerge', () => {
    beforeEach(() => {
      useSettingsStore.setState({ archiveOnMerge: false });
    });

    it('should have a default value of false', () => {
      const { archiveOnMerge } = useSettingsStore.getState();
      expect(archiveOnMerge).toBe(false);
    });

    it('should update archiveOnMerge when setArchiveOnMerge is called', () => {
      const { setArchiveOnMerge } = useSettingsStore.getState();
      setArchiveOnMerge(true);
      expect(useSettingsStore.getState().archiveOnMerge).toBe(true);
    });

    it('should not affect other settings when setArchiveOnMerge is called', () => {
      const initialState = useSettingsStore.getState();
      const { setArchiveOnMerge } = useSettingsStore.getState();
      setArchiveOnMerge(true);
      const newState = useSettingsStore.getState();
      
      expect(newState.showThinkingBlocks).toBe(initialState.showThinkingBlocks);
      expect(newState.reviewModel).toBe(initialState.reviewModel);
      expect(newState.deleteBranchOnArchive).toBe(initialState.deleteBranchOnArchive);
    });
  });

  describe('autoApproveSafeCommands', () => {
    beforeEach(() => {
      useSettingsStore.setState({ autoApproveSafeCommands: true });
    });

    it('should have a default value of true', () => {
      const { autoApproveSafeCommands } = useSettingsStore.getState();
      expect(autoApproveSafeCommands).toBe(true);
    });

    it('should update autoApproveSafeCommands when setAutoApproveSafeCommands is called', () => {
      const { setAutoApproveSafeCommands } = useSettingsStore.getState();
      setAutoApproveSafeCommands(false);
      expect(useSettingsStore.getState().autoApproveSafeCommands).toBe(false);
    });

    it('should not affect other settings when setAutoApproveSafeCommands is called', () => {
      const initialState = useSettingsStore.getState();
      const { setAutoApproveSafeCommands } = useSettingsStore.getState();
      setAutoApproveSafeCommands(false);
      const newState = useSettingsStore.getState();
      
      expect(newState.showThinkingBlocks).toBe(initialState.showThinkingBlocks);
      expect(newState.reviewModel).toBe(initialState.reviewModel);
      expect(newState.archiveOnMerge).toBe(initialState.archiveOnMerge);
    });
  });

  describe('strictPrivacy', () => {
    beforeEach(() => {
      useSettingsStore.setState({ strictPrivacy: false });
    });

    it('should have a default value of false', () => {
      const { strictPrivacy } = useSettingsStore.getState();
      expect(strictPrivacy).toBe(false);
    });

    it('should update strictPrivacy when setStrictPrivacy is called', () => {
      const { setStrictPrivacy } = useSettingsStore.getState();
      setStrictPrivacy(true);
      expect(useSettingsStore.getState().strictPrivacy).toBe(true);
    });

    it('should not affect other settings when setStrictPrivacy is called', () => {
      const initialState = useSettingsStore.getState();
      const { setStrictPrivacy } = useSettingsStore.getState();
      setStrictPrivacy(true);
      const newState = useSettingsStore.getState();
      
      expect(newState.showThinkingBlocks).toBe(initialState.showThinkingBlocks);
      expect(newState.reviewModel).toBe(initialState.reviewModel);
      expect(newState.autoApproveSafeCommands).toBe(initialState.autoApproveSafeCommands);
    });
  });

  describe('parallelAgents', () => {
    beforeEach(() => {
      useSettingsStore.setState({ parallelAgents: false });
    });

    it('should have a default value of false', () => {
      const { parallelAgents } = useSettingsStore.getState();
      expect(parallelAgents).toBe(false);
    });

    it('should update parallelAgents when setParallelAgents is called', () => {
      const { setParallelAgents } = useSettingsStore.getState();
      setParallelAgents(true);
      expect(useSettingsStore.getState().parallelAgents).toBe(true);
    });

    it('should not affect other settings when setParallelAgents is called', () => {
      const initialState = useSettingsStore.getState();
      const { setParallelAgents } = useSettingsStore.getState();
      setParallelAgents(true);
      const newState = useSettingsStore.getState();
      
      expect(newState.showThinkingBlocks).toBe(initialState.showThinkingBlocks);
      expect(newState.reviewModel).toBe(initialState.reviewModel);
      expect(newState.strictPrivacy).toBe(initialState.strictPrivacy);
    });
  });

  describe('developerMode', () => {
    beforeEach(() => {
      useSettingsStore.setState({ developerMode: false });
    });

    it('should have a default value of false', () => {
      const { developerMode } = useSettingsStore.getState();
      expect(developerMode).toBe(false);
    });

    it('should update developerMode when setDeveloperMode is called', () => {
      const { setDeveloperMode } = useSettingsStore.getState();
      setDeveloperMode(true);
      expect(useSettingsStore.getState().developerMode).toBe(true);
    });

    it('should not affect other settings when setDeveloperMode is called', () => {
      const initialState = useSettingsStore.getState();
      const { setDeveloperMode } = useSettingsStore.getState();
      setDeveloperMode(true);
      const newState = useSettingsStore.getState();
      
      expect(newState.showThinkingBlocks).toBe(initialState.showThinkingBlocks);
      expect(newState.reviewModel).toBe(initialState.reviewModel);
      expect(newState.parallelAgents).toBe(initialState.parallelAgents);
    });
  });

  describe('getBranchPrefix', () => {
    beforeEach(() => {
      useSettingsStore.setState({ 
        branchPrefixType: 'github',
        branchPrefixCustom: ''
      });
    });

    it('should return undefined for github type', () => {
      useSettingsStore.setState({ branchPrefixType: 'github' });

      expect(getBranchPrefix()).toBeUndefined();
    });

    it('should return empty string for none type', () => {
      useSettingsStore.setState({ branchPrefixType: 'none' });

      expect(getBranchPrefix()).toBe('');
    });

    it('should return custom prefix for custom type', () => {
      useSettingsStore.setState({ 
        branchPrefixType: 'custom',
        branchPrefixCustom: 'my-prefix'
      });

      expect(getBranchPrefix()).toBe('my-prefix');
    });

    it('should return undefined for custom type when custom prefix is empty', () => {
      useSettingsStore.setState({ 
        branchPrefixType: 'custom',
        branchPrefixCustom: ''
      });

      expect(getBranchPrefix()).toBeUndefined();
    });

    it('should handle whitespace-only custom prefix as empty', () => {
      useSettingsStore.setState({ 
        branchPrefixType: 'custom',
        branchPrefixCustom: '   '
      });

      expect(getBranchPrefix()).toBeUndefined();
    });

    it('should preserve custom prefix with valid characters', () => {
      const customPrefixes = [
        'feature',
        'bugfix',
        'hotfix',
        'my-team',
        'user/feature',
        'prefix_123'
      ];

      customPrefixes.forEach(prefix => {
        useSettingsStore.setState({ 
          branchPrefixType: 'custom',
          branchPrefixCustom: prefix
        });
  
        expect(getBranchPrefix()).toBe(prefix);
      });
    });
  });
});
