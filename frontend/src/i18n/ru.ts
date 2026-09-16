import type { Dictionary } from './en'

// Russian translation — typed against en.ts's own key set (Record<keyof
// Dictionary, string>, not Dictionary itself: en.ts's dictionary is `as
// const`, so Dictionary's values are literal English strings a
// translation obviously can't reuse; only the *keys* need to match) so a
// key added to en.ts and left untranslated here is a compile error, not a
// silent fallback to English at runtime.
export const dictionary: Record<keyof Dictionary, string> = {
  'common.close': 'Закрыть',
  'common.cancel': 'Отмена',
  'common.none': '— нет —',
  'common.idLabel': 'ID: {{id}}',

  'sidebar.file': 'Файл',
  'sidebar.elements': 'Элементы',
  'sidebar.settings': 'Настройки',
  'sidebar.properties': 'Свойства',

  'file.new': 'Новая',
  'file.namePlaceholder': 'Имя схемы',
  'file.create': 'Создать',
  'file.open': 'Открыть',
  'file.noDiagrams': 'Сохранённых схем пока нет.',
  'file.save': 'Сохранить',
  'file.saveAs': 'Сохранить как',
  'file.newDiagramTitle': 'Новая схема',
  'file.name': 'Имя',
  'file.width': 'Ширина',
  'file.height': 'Высота',
  'file.defaultVoltage': 'Напряжение по умолчанию',
  'file.defaultVoltageHint':
    'Вновь размещаемые элементы и связи будут иметь этот класс напряжения вместо отсутствующего.',

  'elements.uncategorized': 'Прочее',
  'elements.empty': 'Библиотеки элементов не настроены.',
  'elements.pickHint': 'Выберите элемент, затем щёлкните на схеме, чтобы разместить его.',
  'elements.armedHint': 'Щёлкните на схеме, чтобы разместить «{{name}}». Esc — отмена.',

  'settings.noDiagram': 'Откройте или создайте схему, чтобы изменить её настройки.',
  'settings.gridSpacing': 'Шаг сетки',
  'settings.snapToGrid': 'Привязка к сетке',
  'settings.showGrid': 'Показывать сетку',
  'settings.showNodes': 'Показывать узлы',
  'settings.background': 'Цвет фона',
  'settings.defaultVoltage': 'Напряжение по умолчанию',
  'settings.voltageClasses': 'Классы напряжения',
  'settings.noVoltageClasses': 'Классов напряжения пока нет — добавьте один ниже, чтобы назначить его элементам.',
  'settings.pickVoltage': 'Выберите класс напряжения…',
  'settings.addVoltageClass': 'Добавить',
  'settings.deleteVoltageClass': 'Удалить класс напряжения',

  'properties.noSelection': 'Выберите элемент на схеме, чтобы изменить его свойства.',
  'properties.name': 'Имя',
  'properties.voltageClass': 'Класс напряжения',
  'properties.state': 'Состояние',
  'properties.orientation': 'Ориентация',
  'properties.points': 'Точки',
  'properties.pointX': 'Точка {{n}}, X',
  'properties.pointY': 'Точка {{n}}, Y',
  'properties.connectHint': 'Ctrl/Cmd + щелчок по другому элементу на схеме, чтобы соединить их.',
  'properties.connectorKind': 'Связь ({{kind}})',
  'properties.deleteElement': 'Удалить элемент',
  'properties.multiSelection': 'Выбрано элементов: {{count}}',
  'properties.deleteElements': 'Удалить элементы',
  'properties.deleteConnector': 'Удалить связь',

  'canvas.noDiagram': 'Создайте или откройте схему на панели «Файл», чтобы начать.',

  'contextMenu.copy': 'Копировать',
  'contextMenu.paste': 'Вставить',
  'contextMenu.delete': 'Удалить',
  'contextMenu.deleteSegment': 'Удалить сегмент',
  'contextMenu.deleteWire': 'Удалить провод',
}
