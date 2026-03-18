import { Tag } from 'lucide-react'
import { useLang } from '../i18n'
import StubScreen from '../components/StubScreen'

export default function Services() {
  const { t } = useLang()
  return (
    <StubScreen
      icon={Tag}
      title={t('services_title')}
      description={t('services_desc')}
      features={[
        t('services_feat_1'),
        t('services_feat_2'),
        t('services_feat_3'),
      ]}
    />
  )
}
