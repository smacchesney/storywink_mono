import { useReducer, useCallback } from 'react';
import { BookWithStoryboardPages, StoryboardPage } from '@storywink/shared';
import { EditorTab } from '@/components/create/editor/BottomToolbar';

// Define the state shape
interface BookEditorState {
  // Book data
  bookData: BookWithStoryboardPages | null;
  isLoading: boolean;
  error: string | null;
  
  // UI states
  activeTab: EditorTab;
  isPhotoSheetOpen: boolean;
  isPagesPanelOpen: boolean;
  isArtStylePanelOpen: boolean;
  isCoverPanelOpen: boolean;
  isDetailsPanelOpen: boolean;
  showGenerationProgress: boolean;
  showPhotoUploadProgress: boolean;
  
  // Pending changes
  pendingArtStyle: string | null | undefined;
  pendingWinkifyEnabled: boolean;
  pendingTitle: string;
  pendingCoverAssetId: string | null | undefined;
  
  // Loading states
  isSavingOrder: boolean;
  isSavingArtStyle: boolean;
  isSavingCover: boolean;
  isSavingDetails: boolean;
  isGeneratingStory: boolean;
  isAddingPhoto: boolean;
  
  // Page management
  storyboardOrder: StoryboardPage[];
  completedSteps: Set<EditorTab>;
  pagesResetKey: number;
  pagesConfirmed: boolean;
  
  // Tour
  runTour: boolean;
}

// Action types
type BookEditorAction =
  | { type: 'SET_BOOK_DATA'; payload: BookWithStoryboardPages | null }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_ACTIVE_TAB'; payload: EditorTab }
  | { type: 'TOGGLE_PANEL'; panel: keyof BookEditorState; value?: boolean }
  | { type: 'SET_PENDING_STYLE'; artStyle: string | null | undefined; winkify: boolean }
  | { type: 'SET_PENDING_COVER'; title: string; assetId: string | null | undefined }
  | { type: 'SET_SAVING_STATE'; key: keyof BookEditorState; value: boolean }
  | { type: 'SET_STORYBOARD_ORDER'; payload: StoryboardPage[] }
  | { type: 'MARK_STEP_COMPLETED'; step: EditorTab }
  | { type: 'SET_PAGES_CONFIRMED'; value: boolean }
  | { type: 'INCREMENT_PAGES_RESET_KEY' }
  | { type: 'SET_TOUR_STATE'; value: boolean };

// Initial state
const initialState: BookEditorState = {
  bookData: null,
  isLoading: true,
  error: null,
  activeTab: 'details',
  isPhotoSheetOpen: false,
  isPagesPanelOpen: false,
  isArtStylePanelOpen: false,
  isCoverPanelOpen: false,
  isDetailsPanelOpen: false,
  showGenerationProgress: false,
  showPhotoUploadProgress: false,
  pendingArtStyle: undefined,
  pendingWinkifyEnabled: false,
  pendingTitle: '',
  pendingCoverAssetId: undefined,
  isSavingOrder: false,
  isSavingArtStyle: false,
  isSavingCover: false,
  isSavingDetails: false,
  isGeneratingStory: false,
  isAddingPhoto: false,
  storyboardOrder: [],
  completedSteps: new Set(),
  pagesResetKey: 0,
  pagesConfirmed: false,
  runTour: false,
};

// Reducer
function bookEditorReducer(state: BookEditorState, action: BookEditorAction): BookEditorState {
  switch (action.type) {
    case 'SET_BOOK_DATA':
      return { ...state, bookData: action.payload };
    
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.payload };
    
    case 'TOGGLE_PANEL':
      return { ...state, [action.panel]: action.value !== undefined ? action.value : !state[action.panel as keyof BookEditorState] };
    
    case 'SET_PENDING_STYLE':
      return { 
        ...state, 
        pendingArtStyle: action.artStyle, 
        pendingWinkifyEnabled: action.winkify 
      };
    
    case 'SET_PENDING_COVER':
      return {
        ...state,
        pendingTitle: action.title,
        pendingCoverAssetId: action.assetId
      };
    
    case 'SET_SAVING_STATE':
      return { ...state, [action.key]: action.value };
    
    case 'SET_STORYBOARD_ORDER':
      return { ...state, storyboardOrder: action.payload };
    
    case 'MARK_STEP_COMPLETED':
      return { 
        ...state, 
        completedSteps: new Set(Array.from(state.completedSteps).concat([action.step])) 
      };
    
    case 'SET_PAGES_CONFIRMED':
      return { ...state, pagesConfirmed: action.value };
    
    case 'INCREMENT_PAGES_RESET_KEY':
      return { ...state, pagesResetKey: state.pagesResetKey + 1 };
    
    case 'SET_TOUR_STATE':
      return { ...state, runTour: action.value };
    
    default:
      return state;
  }
}

// Custom hook
export function useBookEditor() {
  const [state, dispatch] = useReducer(bookEditorReducer, initialState);

  // Action creators
  const setBookData = useCallback((data: BookWithStoryboardPages | null) => {
    dispatch({ type: 'SET_BOOK_DATA', payload: data });
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    dispatch({ type: 'SET_LOADING', payload: loading });
  }, []);

  const setError = useCallback((error: string | null) => {
    dispatch({ type: 'SET_ERROR', payload: error });
  }, []);

  const setActiveTab = useCallback((tab: EditorTab) => {
    dispatch({ type: 'SET_ACTIVE_TAB', payload: tab });
  }, []);

  const togglePanel = useCallback((panel: keyof BookEditorState, value?: boolean) => {
    dispatch({ type: 'TOGGLE_PANEL', panel, value });
  }, []);

  const setPendingStyle = useCallback((artStyle: string | null | undefined, winkify: boolean) => {
    dispatch({ type: 'SET_PENDING_STYLE', artStyle, winkify });
  }, []);

  const setPendingCover = useCallback((title: string, assetId: string | null | undefined) => {
    dispatch({ type: 'SET_PENDING_COVER', title, assetId });
  }, []);

  const setSavingState = useCallback((key: keyof BookEditorState, value: boolean) => {
    dispatch({ type: 'SET_SAVING_STATE', key, value });
  }, []);

  const setStoryboardOrder = useCallback((order: StoryboardPage[]) => {
    dispatch({ type: 'SET_STORYBOARD_ORDER', payload: order });
  }, []);

  const markStepCompleted = useCallback((step: EditorTab) => {
    dispatch({ type: 'MARK_STEP_COMPLETED', step });
  }, []);

  const setPagesConfirmed = useCallback((value: boolean) => {
    dispatch({ type: 'SET_PAGES_CONFIRMED', value });
  }, []);

  const incrementPagesResetKey = useCallback(() => {
    dispatch({ type: 'INCREMENT_PAGES_RESET_KEY' });
  }, []);

  const setTourState = useCallback((value: boolean) => {
    dispatch({ type: 'SET_TOUR_STATE', value });
  }, []);

  return {
    state,
    actions: {
      setBookData,
      setLoading,
      setError,
      setActiveTab,
      togglePanel,
      setPendingStyle,
      setPendingCover,
      setSavingState,
      setStoryboardOrder,
      markStepCompleted,
      setPagesConfirmed,
      incrementPagesResetKey,
      setTourState,
    },
  };
}