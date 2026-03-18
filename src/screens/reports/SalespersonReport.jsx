import { TrendingUp } from 'lucide-react'
import { useLang } from '../../i18n'
import StubScreen from '../../components/StubScreen'

export default function SalespersonReport() {
  const { t } = useLang()
  return (
    <StubScreen
      icon={TrendingUp}
      title={t('salesperson_title')}
      description={t('salesperson_desc')}
      features={[
        t('salesperson_feat_1'),
        t('salesperson_feat_2'),
        t('salesperson_feat_3'),
        t('salesperson_feat_4'),
      ]}
    />
  )
}
