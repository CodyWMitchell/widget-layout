import 'react-grid-layout/css/styles.css';
import './GridLayout.scss';
import { Layout, ReactGridLayoutProps, Responsive, ResponsiveProps, WidthProvider } from 'react-grid-layout';
import ResizeHandleIcon from './resize-handle.svg';
import GridTile, { SetWidgetAttribute } from './GridTile';
import { KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isWidgetType } from '../Widgets/widgetTypes';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { currentDropInItemAtom } from '../../state/currentDropInItemAtom';
import { widgetMappingAtom } from '../../state/widgetMappingAtom';
import { activeItemAtom, layoutVariantAtom } from '../../state/layoutAtom';
import { templateAtom, templateIdAtom } from '../../state/templateAtom';
import DebouncePromise from 'awesome-debounce-promise';
import React from 'react';
import {
  ExtendedLayoutItem,
  LayoutTypes,
  Variants,
  getDashboardTemplates,
  getDefaultTemplate,
  getWidgetIdentifier,
  mapPartialExtendedTemplateConfigToPartialTemplateConfig,
  mapTemplateConfigToExtendedTemplateConfig,
  patchDashboardTemplate,
} from '../../api/dashboard-templates';
import useCurrentUser from '../../hooks/useCurrentUser';
import { EmptyState, EmptyStateBody, EmptyStateHeader, EmptyStateIcon, EmptyStateVariant, PageSection } from '@patternfly/react-core';
import { GripVerticalIcon, PlusCircleIcon } from '@patternfly/react-icons';
import { getWidget } from '../Widgets/widgetDefaults';
import { drawerExpandedAtom } from '../../state/drawerExpandedAtom';
import { columns, dropping_elem_id } from '../../consts';
import { useAddNotification } from '../../state/notificationsAtom';

export const breakpoints = { xl: 1100, lg: 996, md: 768, sm: 480 };

const ResponsiveGridLayout = WidthProvider(Responsive);

const getResizeHandle = (resizeHandleAxis: string, ref: React.Ref<HTMLDivElement>) => {
  return (
    <div ref={ref} className={`react-resizable-handle react-resizable-handle-${resizeHandleAxis}`}>
      <img src={ResizeHandleIcon} />
    </div>
  );
};

const LayoutEmptyState = () => {
  const setDrawerExpanded = useSetAtom(drawerExpandedAtom);

  useEffect(() => {
    setDrawerExpanded(true);
  }, []);

  return (
    <PageSection className="empty-layout pf-v5-u-p-0">
      <EmptyState variant={EmptyStateVariant.lg} className="pf-v5-u-p-sm">
        <EmptyStateHeader titleText="No dashboard content" headingLevel="h2" icon={<EmptyStateIcon icon={PlusCircleIcon} />} />
        <EmptyStateBody>
          You don’t have any widgets on your dashboard. To populate your dashboard, drag <GripVerticalIcon /> items from the blue widget bank to this
          dashboard body here.
        </EmptyStateBody>
        {/* TODO: Add link to documentation once available [HCCDOC-2108]
        <EmptyStateActions>
          <Button variant="link" icon={<ExternalLinkAltIcon />} iconPosition="end" component="a" href={`#`}>
            Learn about your widget dashboard
          </Button>
        </EmptyStateActions> */}
      </EmptyState>
    </PageSection>
  );
};

const debouncedPatchDashboardTemplate = DebouncePromise(patchDashboardTemplate, 2500, {
  onlyResolvesLast: true,
});

const GridLayout = ({ isLayoutLocked = false, layoutType = 'landingPage' }: { isLayoutLocked?: boolean; layoutType?: LayoutTypes }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isInitialRender, setIsInitialRender] = useState(true);
  const [isLoaded, setIsLoaded] = useState(false);
  const [layoutVariant, setLayoutVariant] = useAtom(layoutVariantAtom);
  const [template, setTemplate] = useAtom(templateAtom);
  const [templateId, setTemplateId] = useAtom(templateIdAtom);
  const [activeItem, setActiveItem] = useAtom(activeItemAtom);
  const layoutRef = useRef<HTMLDivElement>(null);
  const { currentUser } = useCurrentUser();
  const widgetMapping = useAtomValue(widgetMappingAtom);
  const addNotification = useAddNotification();

  const [currentDropInItem, setCurrentDropInItem] = useAtom(currentDropInItemAtom);
  const droppingItemTemplate: ReactGridLayoutProps['droppingItem'] = useMemo(() => {
    if (currentDropInItem && isWidgetType(widgetMapping, currentDropInItem)) {
      return {
        ...widgetMapping[currentDropInItem].defaults,
        i: dropping_elem_id,
        widgetType: currentDropInItem,
        title: 'New title',
        config: widgetMapping[currentDropInItem].config,
      };
    }
  }, [currentDropInItem]);

  const setWidgetAttribute: SetWidgetAttribute = (id, attributeName, value) =>
    setTemplate((prev) =>
      Object.entries(prev).reduce(
        (acc, [size, layout]) => ({
          ...acc,
          [size]: layout.map((widget) => (widget.i === id ? { ...widget, [attributeName]: value } : widget)),
        }),
        prev
      )
    );

  const removeWidget = (id: string) =>
    setTemplate((prev) =>
      Object.entries(prev).reduce(
        (acc, [size, layout]) => ({
          ...acc,
          [size]: layout.filter((widget) => widget.i !== id),
        }),
        prev
      )
    );

  const onDrop: ReactGridLayoutProps['onDrop'] = (_layout: ExtendedLayoutItem[], layoutItem: ExtendedLayoutItem, event: DragEvent) => {
    const data = event.dataTransfer?.getData('text') || '';
    if (isWidgetType(widgetMapping, data)) {
      setCurrentDropInItem(undefined);
      setTemplate((prev) =>
        Object.entries(prev).reduce((acc, [size, layout]) => {
          const newWidget = {
            ...layoutItem,
            ...widgetMapping[data].defaults,
            // make sure the configuration is valid for all layout sizes
            w: size === layoutVariant ? layoutItem.w : Math.min(widgetMapping[data].defaults.w, columns[size as Variants]),
            x: size === layoutVariant ? layoutItem.x : Math.min(layoutItem.x, columns[size as Variants]),
            widgetType: data,
            i: getWidgetIdentifier(data),
            title: 'New title',
            config: widgetMapping[data].config,
          };
          return {
            ...acc,
            [size]: layout.reduce<ExtendedLayoutItem[]>(
              (acc, curr) => {
                if (curr.x + curr.w > newWidget.x && curr.y + curr.h <= newWidget.y) {
                  acc.push(curr);
                } else {
                  // push the current items down on the Y axis if they are supposed to be below the new widget
                  acc.push({ ...curr, y: curr.y + curr.h });
                }

                return acc;
              },
              [newWidget]
            ),
          };
        }, prev)
      );
    }
    event.preventDefault();
  };

  const activeLayout = useMemo(
    () =>
      template[layoutVariant].map((item) => ({
        ...item,
        locked: isLayoutLocked ? isLayoutLocked : item.locked,
      })),
    [isLayoutLocked, template]
  );

  const onLayoutChange: ResponsiveProps['onLayoutChange'] = async (currentLayout: Layout[]) => {
    if (isInitialRender) {
      setIsInitialRender(false);
      return;
    }
    if (isLayoutLocked || templateId < 0 || !layoutVariant || currentDropInItem) {
      return;
    }

    const data = mapPartialExtendedTemplateConfigToPartialTemplateConfig({ ...template, [layoutVariant]: currentLayout });

    try {
      const template = await debouncedPatchDashboardTemplate(templateId, { templateConfig: data });
      if (!template) {
        return;
      }

      const extendedTemplateConfig = mapTemplateConfigToExtendedTemplateConfig(template.templateConfig);
      setTemplate(extendedTemplateConfig);
    } catch (error) {
      console.error(error);
      addNotification({
        variant: 'danger',
        title: 'Failed to patch dashboard configuration',
        description: 'Your dashboard changes were unable to be saved.',
      });
    }
  };

  const onBreakpointChange: ResponsiveProps['onBreakpointChange'] = (newBreakpoint: Variants) => setLayoutVariant(newBreakpoint);

  const onKeyUp = (event: KeyboardEvent<HTMLDivElement>, id: string) => {
    if (event.code === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      setActiveItem((prev) => {
        if (prev === id) {
          return undefined;
        }
        return id;
      });
    }
  };

  const updateLayout = async (updatedItem: ExtendedLayoutItem) => {
    setTemplate((prev) =>
      Object.entries(prev).reduce(
        (acc, [size, layout]) => ({
          ...acc,
          [size]: size === layoutVariant ? layout.map((layoutItem) => (layoutItem.i === activeItem ? updatedItem : layoutItem)) : layout,
        }),
        prev
      )
    );

    if (isLayoutLocked || templateId < 0 || !layoutVariant || currentDropInItem) {
      return;
    }

    const data = mapPartialExtendedTemplateConfigToPartialTemplateConfig({ [layoutVariant]: template[layoutVariant] });

    try {
      const template = await debouncedPatchDashboardTemplate(templateId, { templateConfig: data });
      const extendedTemplateConfig = mapTemplateConfigToExtendedTemplateConfig(template.templateConfig);
      setTemplate(extendedTemplateConfig);
    } catch (error) {
      console.error(error);
      addNotification({
        variant: 'danger',
        title: 'Failed to patch dashboard configuration',
        description: 'Your dashboard changes were unable to be saved.',
      });
    }
  };

  const handleArrows = useCallback(
    (e: globalThis.KeyboardEvent) => {
      if (!activeItem) {
        return;
      }

      const item = template[layoutVariant].find(({ i }) => i === activeItem);
      if (!item) {
        return;
      }

      e.stopPropagation();
      e.preventDefault();

      if (e.code === 'ArrowUp') {
        updateLayout({
          ...item,
          y: Math.max(item.y - 1, 0),
        });
      }

      if (e.code === 'ArrowDown') {
        updateLayout({
          ...item,
          y: item.y + 1,
        });
      }

      if (e.code === 'ArrowLeft') {
        updateLayout({
          ...item,
          x: Math.max(item.x - 1, 0),
        });
      }

      if (e.code === 'ArrowRight') {
        updateLayout({
          ...item,
          x: item.x + 1,
        });
      }
    },
    [activeItem, template, isLayoutLocked, templateId, layoutVariant, currentDropInItem]
  );

  useEffect(() => {
    if (activeItem && layoutRef.current) {
      layoutRef.current.addEventListener('keydown', handleArrows);
    }
    return () => {
      layoutRef.current?.removeEventListener('keydown', handleArrows);
    };
  }, [activeItem]);

  useEffect(() => {
    if (!currentUser || templateId >= 0) {
      return;
    }
    // TODO template type should be pulled from app config for reusability
    getDashboardTemplates(layoutType)
      .then((templates) => {
        const customDefaultTemplate = getDefaultTemplate(templates);
        if (!customDefaultTemplate) {
          throw new Error('No custom default template found');
        }
        const extendedTemplateConfig = mapTemplateConfigToExtendedTemplateConfig(customDefaultTemplate.templateConfig);
        const currentWidth = layoutRef?.current?.clientWidth || document.body.clientWidth;
        let targetVariant: Variants;
        if (currentWidth > breakpoints.lg) {
          targetVariant = 'xl';
        } else if (breakpoints.lg >= currentWidth && currentWidth > breakpoints.md) {
          targetVariant = 'lg';
        } else if (breakpoints.md >= currentWidth && currentWidth > breakpoints.sm) {
          targetVariant = 'md';
        } else {
          targetVariant = 'sm';
        }
        setTemplate(extendedTemplateConfig);
        setTemplateId(customDefaultTemplate.id);
        setLayoutVariant(targetVariant);
      })
      .catch((err) => {
        console.error(err);
        addNotification({
          variant: 'danger',
          title: 'Failed to fetch dashboard template',
          description: 'Try reloading the page.',
        });
      })
      .finally(() => {
        setIsLoaded(true);
      });
  }, [currentUser, templateId]);

  return (
    // {/* relative position is required for the grid layout to properly calculate
    // child translation while dragging is in progress */}
    <div style={{ position: 'relative' }} ref={layoutRef}>
      {activeLayout.length === 0 && !currentDropInItem && isLoaded && <LayoutEmptyState />}
      <ResponsiveGridLayout
        className="layout"
        draggableHandle=".drag-handle"
        layouts={template}
        breakpoints={breakpoints}
        cols={columns}
        rowHeight={56}
        //width={1200}
        isDraggable={!isLayoutLocked}
        isResizable={!isLayoutLocked}
        resizeHandle={getResizeHandle}
        containerPadding={{ xl: [0, 0], lg: [0, 0], md: [0, 0], sm: [0, 0] }}
        margin={{ xl: [16, 16], lg: [16, 16], md: [16, 16], sm: [16, 16] }}
        resizeHandles={['sw', 'nw', 'se', 'ne']}
        // add droppping item default based on dragged template
        droppingItem={droppingItemTemplate}
        isDroppable={!isLayoutLocked}
        onDrop={onDrop}
        useCSSTransforms
        verticalCompact
        onLayoutChange={onLayoutChange}
        onBreakpointChange={onBreakpointChange}
      >
        {activeLayout
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          .map(({ widgetType, title, ...rest }, index) => {
            const widget = getWidget(widgetMapping, widgetType);
            if (!widget) {
              return null;
            }
            const config = widgetMapping[widgetType]?.config;
            return (
              <div
                key={rest.i}
                data-grid={rest}
                onKeyUp={(e) => onKeyUp(e, rest.i)}
                tabIndex={index}
                style={{
                  boxShadow: activeItem === rest.i ? '0 0 2px 2px #2684FF' : 'none',
                  ...(activeItem === rest.i ? { outline: 'none' } : {}),
                }}
                className={`widget-columns-${rest.w} widget-rows-${rest.h}`}
              >
                <GridTile
                  isDragging={isDragging}
                  setIsDragging={setIsDragging}
                  widgetType={widgetType}
                  // these will be dynamically calculated once the dimensions are calculated
                  widgetConfig={{ ...rest, colWidth: 1200 / 4, config }}
                  setWidgetAttribute={setWidgetAttribute}
                  removeWidget={removeWidget}
                >
                  {rest.i}
                </GridTile>
              </div>
            );
          })
          .filter((layoutItem) => layoutItem !== null)}
      </ResponsiveGridLayout>
    </div>
  );
};

export default GridLayout;
