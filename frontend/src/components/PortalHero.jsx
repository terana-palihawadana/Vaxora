import '../styles/portal-hero.css';

/**
 * Shared page banner for every portal.
 * With `image` it is the large home banner (photo fades into the mint band);
 * without it, the compact banner used on every other page.
 * Extra content (pills, tabs, buttons) goes in `children`, below the subtitle.
 */
export default function PortalHero({ eyebrow, title, subtitle, image, imagePosition, className = '', children }) {
  const classes = ['portal-hero', image ? 'portal-hero--home' : 'portal-hero--compact', className]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={classes}>
      <div className="portal-hero__content">
        {eyebrow ? <p className="portal-hero__eyebrow">{eyebrow}</p> : null}
        <h1 className="portal-hero__title">{title}</h1>
        {subtitle ? <p className="portal-hero__sub">{subtitle}</p> : null}
        {children ? <div className="portal-hero__extra">{children}</div> : null}
      </div>
      {image ? (
        <div className="portal-hero__media" aria-hidden="true">
          <img src={image} alt="" className="portal-hero__image" style={imagePosition ? { objectPosition: imagePosition } : undefined} />
        </div>
      ) : null}
    </section>
  );
}
