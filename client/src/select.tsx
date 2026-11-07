import {
  Children,
  useCallback,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import * as Primitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import "./select.css";
interface Option {
  value: string;
  label: string;
  disabled: boolean;
}
interface OptionProps {
  value?: string | number;
  children?: ReactNode;
  disabled?: boolean;
  hidden?: boolean;
}
function textContent(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      typeof child === "string" || typeof child === "number"
        ? String(child)
        : isValidElement<{ children?: ReactNode }>(child)
          ? textContent(child.props.children)
          : "",
    )
    .join("");
}
function optionsFrom(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<OptionProps>(child)) return [];
    if (child.type === "option")
      return child.props.hidden
        ? []
        : [
            {
              value: String(child.props.value ?? textContent(child.props.children)),
              label: textContent(child.props.children),
              disabled: !!child.props.disabled,
            },
          ];
    return optionsFrom(child.props.children);
  });
}
type SelectProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "value" | "defaultValue" | "onChange" | "children"
> & {
  children: ReactNode;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  required?: boolean;
};
const emptyValue = "__tapcart_empty_option__";
/** App-styled picker with Radix keyboard/focus behavior and a real native form value.
 * Native options are accepted as data so all catalog/tenant option lists keep one source of truth. */
export function Select({
  children,
  value,
  defaultValue,
  onValueChange,
  name,
  required,
  disabled,
  id,
  form,
  className = "",
  ...triggerProps
}: SelectProps) {
  const options = optionsFrom(children),
    initial = defaultValue ?? options.find((option) => !option.disabled)?.value ?? "";
  const [internal, setInternal] = useState(initial),
    [invalid, setInvalid] = useState(false),
    current = value ?? internal;
  const trigger = useRef<HTMLButtonElement>(null),
    native = useRef<HTMLSelectElement>(null),
    generatedId = useId(),
    errorId = generatedId + "-error";
  const restoreBackground = useRef<(() => void) | undefined>(undefined);
  const isolateMenu = useCallback((menu: HTMLDivElement | null) => {
    restoreBackground.current?.();
    restoreBackground.current = undefined;
    if (!menu) return;
    // Radix traps focus and hides siblings from AT; inert also blocks DOM focus.
    const background: Element[] = [];
    let branch: Element = menu;
    while (branch.parentElement && branch !== document.body) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && !sibling.hasAttribute("inert")) {
          sibling.setAttribute("inert", "");
          background.push(sibling);
        }
      }
      branch = branch.parentElement;
    }
    restoreBackground.current = () => {
      for (const element of background) element.removeAttribute("inert");
    };
  }, []);
  const hasChosen = useRef(false),
    resetting = useRef(false);
  useLayoutEffect(() => {
    if (
      value === undefined &&
      !hasChosen.current &&
      !options.some((option) => option.value === internal)
    )
      setInternal(initial);
    const control = native.current;
    if (!control) return;
    for (const option of control.options)
      option.defaultSelected = option.value === (value ?? initial);
    control.value = current;
  });
  useEffect(() => {
    const owner = native.current?.form;
    if (!owner) return;
    const reset = (event: Event) => {
      resetting.current = true;
      // Run after all reset listeners so a canceled reset leaves both displays untouched.
      queueMicrotask(() => {
        resetting.current = false;
        if (event.defaultPrevented) return;
        hasChosen.current = false;
        setInternal(initial);
        setInvalid(false);
        if (native.current) native.current.value = value ?? initial;
      });
    };
    owner.addEventListener("reset", reset, true);
    return () => owner.removeEventListener("reset", reset, true);
  }, [initial, value]);
  function change(next: string) {
    if (resetting.current) return;
    hasChosen.current = true;
    setInternal(next);
    setInvalid(false);
    onValueChange?.(next);
  }
  return (
    <span className="select-field">
      <Primitive.Root
        value={current === "" ? emptyValue : current}
        onValueChange={(next) => change(next === emptyValue ? "" : next)}
        disabled={disabled}
      >
        <Primitive.Trigger
          {...triggerProps}
          type="button"
          ref={trigger}
          id={id}
          className={`select-trigger ${className}`}
          aria-required={required || undefined}
          aria-invalid={invalid || triggerProps["aria-invalid"]}
          aria-describedby={
            [triggerProps["aria-describedby"], invalid ? errorId : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
          <Primitive.Value placeholder="Choose an option">
            {options.find((option) => option.value === current)?.label ?? "Choose an option"}
          </Primitive.Value>
          <Primitive.Icon asChild>
            <ChevronDown size={15} aria-hidden="true" />
          </Primitive.Icon>
        </Primitive.Trigger>
        <Primitive.Portal>
          <Primitive.Content
            ref={isolateMenu}
            onCloseAutoFocus={() => restoreBackground.current?.()}
            className="select-menu"
            position="popper"
            sideOffset={6}
            collisionPadding={12}
          >
            <Primitive.ScrollUpButton className="select-scroll">
              <ChevronUp size={15} />
            </Primitive.ScrollUpButton>
            <Primitive.Viewport className="select-viewport">
              {options.map((option) => (
                <Primitive.Item
                  className="select-option"
                  key={option.value}
                  value={option.value === "" ? emptyValue : option.value}
                  disabled={option.disabled}
                  textValue={option.label}
                >
                  <Primitive.ItemIndicator className="select-check">
                    <Check size={15} />
                  </Primitive.ItemIndicator>
                  <Primitive.ItemText>{option.label}</Primitive.ItemText>
                </Primitive.Item>
              ))}
            </Primitive.Viewport>
            <Primitive.ScrollDownButton className="select-scroll">
              <ChevronDown size={15} />
            </Primitive.ScrollDownButton>
          </Primitive.Content>
        </Primitive.Portal>
      </Primitive.Root>
      <select
        className="select-native"
        aria-hidden="true"
        tabIndex={-1}
        ref={native}
        name={name}
        form={form}
        value={current}
        required={required}
        disabled={disabled}
        onChange={(event) => change(event.currentTarget.value)}
        onInvalid={(event) => {
          event.preventDefault();
          setInvalid(true);
          trigger.current?.focus();
        }}
      >
        {!options.some((option) => option.value === "") && <option value="" />}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      {invalid && (
        <span className="select-error" id={errorId} aria-hidden="true">
          Choose an option.
        </span>
      )}
    </span>
  );
}
