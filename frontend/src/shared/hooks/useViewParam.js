import { useSearchParams } from 'react-router-dom';

/**
 * A page's current view, kept in ?view= so links and redirects can open a
 * specific view. The first allowed view is the default and keeps a clean URL.
 */
export default function useViewParam(allowedViews) {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultView = allowedViews[0];
  const requested = searchParams.get('view');
  const view = allowedViews.includes(requested) ? requested : defaultView;

  const setView = (next) => {
    setSearchParams(next === defaultView ? {} : { view: next }, { replace: true });
  };

  return [view, setView];
}
