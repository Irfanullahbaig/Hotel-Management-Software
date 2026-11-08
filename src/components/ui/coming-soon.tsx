import { Card, CardBody } from "./card";
import { PageHeader } from "./layout";

export function ComingSoon({ title, phase, items }: { title: string; phase: number; items: string[] }) {
  return (
    <>
      <PageHeader title={title} description={`Scheduled for Phase ${phase}. The database model and permissions for this module are already designed (see docs/ARCHITECTURE.md).`} />
      <Card><CardBody>
        <p className="mb-3 text-sm text-ink-2">This module is not built yet, so it shows no data rather than sample figures. It will include:</p>
        <ul className="grid list-disc gap-1 pl-5 text-sm text-ink-2 sm:grid-cols-2">{items.map((i) => <li key={i}>{i}</li>)}</ul>
      </CardBody></Card>
    </>
  );
}
