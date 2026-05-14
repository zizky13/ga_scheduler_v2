import { PageHeader } from '../components/ContentArea';

interface PlaceholderPageProps {
  title: string;
  description?: string;
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <PageHeader
      title={title}
      description={description ?? 'This page is under construction.'}
    />
  );
}
