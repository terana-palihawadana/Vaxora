import {
  IconUser,
  IconDoctor,
  IconNurse,
  IconHospital,
  IconShield,
} from '../../../shared/icons/AppIcons';

const roles = [
  {
    Icon: IconUser,
    name: 'Patient',
    tone: 'teal',
    tasks: ['Book appointments', 'View vaccination history', 'Get a care plan'],
  },
  {
    Icon: IconDoctor,
    name: 'Doctor',
    tone: 'blue',
    tasks: ['Run the booth queue', 'Prescribe vaccines', 'Report reactions'],
  },
  {
    Icon: IconNurse,
    name: 'Nurse',
    tone: 'green',
    tasks: ['Administer doses', 'Record observations', 'Check patient history'],
  },
  {
    Icon: IconHospital,
    name: 'Hospital',
    tone: 'amber',
    tasks: ['Manage staff and rosters', 'Set up booths', 'Track vaccine stock'],
  },
  {
    Icon: IconShield,
    name: 'Ministry admin',
    tone: 'purple',
    tasks: ['Verify staff and hospitals', 'Review audit logs', 'Read feedback'],
  },
];

export default function RolesSection() {
  return (
    <section id="roles" className="landing-section">
      <div className="section-head">
        <span className="section-eyebrow">Built for every role</span>
        <h2 className="landing-section-title">One portal, five ways in</h2>
        <p className="section-lead">
          Each person signs in to a workspace made for their job.
        </p>
      </div>

      <div className="role-grid">
        {roles.map(({ Icon, name, tasks, tone }) => (
          <article key={name} className={`role-card tone-${tone}`}>
            <span className="role-icon">
              <Icon size={22} />
            </span>
            <h3 className="role-name">{name}</h3>
            <ul className="role-tasks">
              {tasks.map((task) => (
                <li key={task}>{task}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
