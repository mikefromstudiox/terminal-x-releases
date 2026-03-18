import { HardHat } from 'lucide-react'
import { useLang } from '../i18n'
import StubScreen from '../components/StubScreen'

export default function Workers() {
  const { t } = useLang()
  return (
    <StubScreen
      icon={HardHat}
      title={t('workers_title')}
      description={t('workers_desc')}
      features={[
        t('workers_feat_1'),
        t('workers_feat_2'),
        t('workers_feat_3'),
        t('workers_feat_4'),
        t('workers_feat_5'),
      ]}
    />
  )
}
