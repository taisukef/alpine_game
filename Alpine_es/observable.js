//import ObservableMembrane from './observable-membrane.js'


  /**
   * Copyright (C) 2017 salesforce.com, inc.
   */
   const { isArray } = Array;
   const { getPrototypeOf, create: ObjectCreate, defineProperty: ObjectDefineProperty, defineProperties: ObjectDefineProperties, isExtensible, getOwnPropertyDescriptor, getOwnPropertyNames, getOwnPropertySymbols, preventExtensions, hasOwnProperty, } = Object;
   const { push: ArrayPush, concat: ArrayConcat, map: ArrayMap, } = Array.prototype;
   function isUndefined(obj) {
       return obj === undefined;
   }
   function isFunction(obj) {
       return typeof obj === 'function';
   }
   function isObject(obj) {
       return typeof obj === 'object';
   }
   const proxyToValueMap = new WeakMap();
   function registerProxy(proxy, value) {
       proxyToValueMap.set(proxy, value);
   }
   export const unwrap = (replicaOrAny) => proxyToValueMap.get(replicaOrAny) || replicaOrAny;
 
   function wrapValue(membrane, value) {
       return membrane.valueIsObservable(value) ? membrane.getProxy(value) : value;
   }
   /**
    * Unwrap property descriptors will set value on original descriptor
    * We only need to unwrap if value is specified
    * @param descriptor external descrpitor provided to define new property on original value
    */
   function unwrapDescriptor(descriptor) {
       if (hasOwnProperty.call(descriptor, 'value')) {
           descriptor.value = unwrap(descriptor.value);
       }
       return descriptor;
   }
   function lockShadowTarget(membrane, shadowTarget, originalTarget) {
       const targetKeys = ArrayConcat.call(getOwnPropertyNames(originalTarget), getOwnPropertySymbols(originalTarget));
       targetKeys.forEach((key) => {
           let descriptor = getOwnPropertyDescriptor(originalTarget, key);
           // We do not need to wrap the descriptor if configurable
           // Because we can deal with wrapping it when user goes through
           // Get own property descriptor. There is also a chance that this descriptor
           // could change sometime in the future, so we can defer wrapping
           // until we need to
           if (!descriptor.configurable) {
               descriptor = wrapDescriptor(membrane, descriptor, wrapValue);
           }
           ObjectDefineProperty(shadowTarget, key, descriptor);
       });
       preventExtensions(shadowTarget);
   }
   class ReactiveProxyHandler {
       constructor(membrane, value) {
           this.originalTarget = value;
           this.membrane = membrane;
       }
       get(shadowTarget, key) {
           const { originalTarget, membrane } = this;
           const value = originalTarget[key];
           const { valueObserved } = membrane;
           valueObserved(originalTarget, key);
           return membrane.getProxy(value);
       }
       set(shadowTarget, key, value) {
           const { originalTarget, membrane: { valueMutated } } = this;
           const oldValue = originalTarget[key];
           if (oldValue !== value) {
               originalTarget[key] = value;
               valueMutated(originalTarget, key);
           }
           else if (key === 'length' && isArray(originalTarget)) {
               // fix for issue #236: push will add the new index, and by the time length
               // is updated, the internal length is already equal to the new length value
               // therefore, the oldValue is equal to the value. This is the forking logic
               // to support this use case.
               valueMutated(originalTarget, key);
           }
           return true;
       }
       deleteProperty(shadowTarget, key) {
           const { originalTarget, membrane: { valueMutated } } = this;
           delete originalTarget[key];
           valueMutated(originalTarget, key);
           return true;
       }
       apply(shadowTarget, thisArg, argArray) {
           /* No op */
       }
       construct(target, argArray, newTarget) {
           /* No op */
       }
       has(shadowTarget, key) {
           const { originalTarget, membrane: { valueObserved } } = this;
           valueObserved(originalTarget, key);
           return key in originalTarget;
       }
       ownKeys(shadowTarget) {
           const { originalTarget } = this;
           return ArrayConcat.call(getOwnPropertyNames(originalTarget), getOwnPropertySymbols(originalTarget));
       }
       isExtensible(shadowTarget) {
           const shadowIsExtensible = isExtensible(shadowTarget);
           if (!shadowIsExtensible) {
               return shadowIsExtensible;
           }
           const { originalTarget, membrane } = this;
           const targetIsExtensible = isExtensible(originalTarget);
           if (!targetIsExtensible) {
               lockShadowTarget(membrane, shadowTarget, originalTarget);
           }
           return targetIsExtensible;
       }
       setPrototypeOf(shadowTarget, prototype) {
       }
       getPrototypeOf(shadowTarget) {
           const { originalTarget } = this;
           return getPrototypeOf(originalTarget);
       }
       getOwnPropertyDescriptor(shadowTarget, key) {
           const { originalTarget, membrane } = this;
           const { valueObserved } = this.membrane;
           // keys looked up via hasOwnProperty need to be reactive
           valueObserved(originalTarget, key);
           let desc = getOwnPropertyDescriptor(originalTarget, key);
           if (isUndefined(desc)) {
               return desc;
           }
           const shadowDescriptor = getOwnPropertyDescriptor(shadowTarget, key);
           if (!isUndefined(shadowDescriptor)) {
               return shadowDescriptor;
           }
           // Note: by accessing the descriptor, the key is marked as observed
           // but access to the value, setter or getter (if available) cannot observe
           // mutations, just like regular methods, in which case we just do nothing.
           desc = wrapDescriptor(membrane, desc, wrapValue);
           if (!desc.configurable) {
               // If descriptor from original target is not configurable,
               // We must copy the wrapped descriptor over to the shadow target.
               // Otherwise, proxy will throw an invariant error.
               // This is our last chance to lock the value.
               // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/handler/getOwnPropertyDescriptor#Invariants
               ObjectDefineProperty(shadowTarget, key, desc);
           }
           return desc;
       }
       preventExtensions(shadowTarget) {
           const { originalTarget, membrane } = this;
           lockShadowTarget(membrane, shadowTarget, originalTarget);
           preventExtensions(originalTarget);
           return true;
       }
       defineProperty(shadowTarget, key, descriptor) {
           const { originalTarget, membrane } = this;
           const { valueMutated } = membrane;
           const { configurable } = descriptor;
           // We have to check for value in descriptor
           // because Object.freeze(proxy) calls this method
           // with only { configurable: false, writeable: false }
           // Additionally, method will only be called with writeable:false
           // if the descriptor has a value, as opposed to getter/setter
           // So we can just check if writable is present and then see if
           // value is present. This eliminates getter and setter descriptors
           if (hasOwnProperty.call(descriptor, 'writable') && !hasOwnProperty.call(descriptor, 'value')) {
               const originalDescriptor = getOwnPropertyDescriptor(originalTarget, key);
               descriptor.value = originalDescriptor.value;
           }
           ObjectDefineProperty(originalTarget, key, unwrapDescriptor(descriptor));
           if (configurable === false) {
               ObjectDefineProperty(shadowTarget, key, wrapDescriptor(membrane, descriptor, wrapValue));
           }
           valueMutated(originalTarget, key);
           return true;
       }
   }
 
   function wrapReadOnlyValue(membrane, value) {
       return membrane.valueIsObservable(value) ? membrane.getReadOnlyProxy(value) : value;
   }
   class ReadOnlyHandler {
       constructor(membrane, value) {
           this.originalTarget = value;
           this.membrane = membrane;
       }
       get(shadowTarget, key) {
           const { membrane, originalTarget } = this;
           const value = originalTarget[key];
           const { valueObserved } = membrane;
           valueObserved(originalTarget, key);
           return membrane.getReadOnlyProxy(value);
       }
       set(shadowTarget, key, value) {
           return false;
       }
       deleteProperty(shadowTarget, key) {
           return false;
       }
       apply(shadowTarget, thisArg, argArray) {
           /* No op */
       }
       construct(target, argArray, newTarget) {
           /* No op */
       }
       has(shadowTarget, key) {
           const { originalTarget, membrane: { valueObserved } } = this;
           valueObserved(originalTarget, key);
           return key in originalTarget;
       }
       ownKeys(shadowTarget) {
           const { originalTarget } = this;
           return ArrayConcat.call(getOwnPropertyNames(originalTarget), getOwnPropertySymbols(originalTarget));
       }
       setPrototypeOf(shadowTarget, prototype) {
       }
       getOwnPropertyDescriptor(shadowTarget, key) {
           const { originalTarget, membrane } = this;
           const { valueObserved } = membrane;
           // keys looked up via hasOwnProperty need to be reactive
           valueObserved(originalTarget, key);
           let desc = getOwnPropertyDescriptor(originalTarget, key);
           if (isUndefined(desc)) {
               return desc;
           }
           const shadowDescriptor = getOwnPropertyDescriptor(shadowTarget, key);
           if (!isUndefined(shadowDescriptor)) {
               return shadowDescriptor;
           }
           // Note: by accessing the descriptor, the key is marked as observed
           // but access to the value or getter (if available) cannot be observed,
           // just like regular methods, in which case we just do nothing.
           desc = wrapDescriptor(membrane, desc, wrapReadOnlyValue);
           if (hasOwnProperty.call(desc, 'set')) {
               desc.set = undefined; // readOnly membrane does not allow setters
           }
           if (!desc.configurable) {
               // If descriptor from original target is not configurable,
               // We must copy the wrapped descriptor over to the shadow target.
               // Otherwise, proxy will throw an invariant error.
               // This is our last chance to lock the value.
               // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/handler/getOwnPropertyDescriptor#Invariants
               ObjectDefineProperty(shadowTarget, key, desc);
           }
           return desc;
       }
       preventExtensions(shadowTarget) {
           return false;
       }
       defineProperty(shadowTarget, key, descriptor) {
           return false;
       }
   }
   function createShadowTarget(value) {
       let shadowTarget = undefined;
       if (isArray(value)) {
           shadowTarget = [];
       }
       else if (isObject(value)) {
           shadowTarget = {};
       }
       return shadowTarget;
   }
   const ObjectDotPrototype = Object.prototype;
   function defaultValueIsObservable(value) {
       // intentionally checking for null
       if (value === null) {
           return false;
       }
       // treat all non-object types, including undefined, as non-observable values
       if (typeof value !== 'object') {
           return false;
       }
       if (isArray(value)) {
           return true;
       }
       const proto = getPrototypeOf(value);
       return (proto === ObjectDotPrototype || proto === null || getPrototypeOf(proto) === null);
   }
   const defaultValueObserved = (obj, key) => {
       /* do nothing */
   };
   const defaultValueMutated = (obj, key) => {
       /* do nothing */
   };
   const defaultValueDistortion = (value) => value;
   function wrapDescriptor(membrane, descriptor, getValue) {
       const { set, get } = descriptor;
       if (hasOwnProperty.call(descriptor, 'value')) {
           descriptor.value = getValue(membrane, descriptor.value);
       }
       else {
           if (!isUndefined(get)) {
               descriptor.get = function () {
                   // invoking the original getter with the original target
                   return getValue(membrane, get.call(unwrap(this)));
               };
           }
           if (!isUndefined(set)) {
               descriptor.set = function (value) {
                   // At this point we don't have a clear indication of whether
                   // or not a valid mutation will occur, we don't have the key,
                   // and we are not sure why and how they are invoking this setter.
                   // Nevertheless we preserve the original semantics by invoking the
                   // original setter with the original target and the unwrapped value
                   set.call(unwrap(this), membrane.unwrapProxy(value));
               };
           }
       }
       return descriptor;
   }
   class ReactiveMembrane {
       constructor(options) {
           this.valueDistortion = defaultValueDistortion;
           this.valueMutated = defaultValueMutated;
           this.valueObserved = defaultValueObserved;
           this.valueIsObservable = defaultValueIsObservable;
           this.objectGraph = new WeakMap();
           if (!isUndefined(options)) {
               const { valueDistortion, valueMutated, valueObserved, valueIsObservable } = options;
               this.valueDistortion = isFunction(valueDistortion) ? valueDistortion : defaultValueDistortion;
               this.valueMutated = isFunction(valueMutated) ? valueMutated : defaultValueMutated;
               this.valueObserved = isFunction(valueObserved) ? valueObserved : defaultValueObserved;
               this.valueIsObservable = isFunction(valueIsObservable) ? valueIsObservable : defaultValueIsObservable;
           }
       }
       getProxy(value) {
           const unwrappedValue = unwrap(value);
           const distorted = this.valueDistortion(unwrappedValue);
           if (this.valueIsObservable(distorted)) {
               const o = this.getReactiveState(unwrappedValue, distorted);
               // when trying to extract the writable version of a readonly
               // we return the readonly.
               return o.readOnly === value ? value : o.reactive;
           }
           return distorted;
       }
       getReadOnlyProxy(value) {
           value = unwrap(value);
           const distorted = this.valueDistortion(value);
           if (this.valueIsObservable(distorted)) {
               return this.getReactiveState(value, distorted).readOnly;
           }
           return distorted;
       }
       unwrapProxy(p) {
           return unwrap(p);
       }
       getReactiveState(value, distortedValue) {
           const { objectGraph, } = this;
           let reactiveState = objectGraph.get(distortedValue);
           if (reactiveState) {
               return reactiveState;
           }
           const membrane = this;
           reactiveState = {
               get reactive() {
                   const reactiveHandler = new ReactiveProxyHandler(membrane, distortedValue);
                   // caching the reactive proxy after the first time it is accessed
                   const proxy = new Proxy(createShadowTarget(distortedValue), reactiveHandler);
                   registerProxy(proxy, value);
                   ObjectDefineProperty(this, 'reactive', { value: proxy });
                   return proxy;
               },
               get readOnly() {
                   const readOnlyHandler = new ReadOnlyHandler(membrane, distortedValue);
                   // caching the readOnly proxy after the first time it is accessed
                   const proxy = new Proxy(createShadowTarget(distortedValue), readOnlyHandler);
                   registerProxy(proxy, value);
                   ObjectDefineProperty(this, 'readOnly', { value: proxy });
                   return proxy;
               }
           };
           objectGraph.set(distortedValue, reactiveState);
           return reactiveState;
       }
   }
   /** version: 0.26.0 */
 

   
export function wrap(data, mutationCallback) {
    /* IE11-ONLY:START */
    return wrapForIe11(data, mutationCallback)
    /* IE11-ONLY:END */


    let membrane = new ObservableMembrane({
        valueMutated(target, key) {
            mutationCallback(target, key)
        },
    })

    return {
        data: membrane.getProxy(data),
        membrane: membrane,
    }
}
/*
export function unwrap(membrane, observable) {
    let unwrappedData = membrane.unwrapProxy(observable)
    let copy = {}

    Object.keys(unwrappedData).forEach(key => {
        if (['$el', '$refs', '$nextTick', '$watch'].includes(key)) return

        copy[key] = unwrappedData[key]
    })

    return copy
}
*/
function wrapForIe11(data, mutationCallback) {
    const proxyHandler = {
        set(target, key, value) {
            // Set the value converting it to a "Deep Proxy" when required
            // Note that if a project is not a valid object, it won't be converted to a proxy
            const setWasSuccessful = Reflect.set(target, key, deepProxy(value, proxyHandler))

            mutationCallback(target, key)

            return setWasSuccessful
        },
        get(target, key) {
            // Provide a way to determine if this object is an Alpine proxy or not.
            if (key === "$isAlpineProxy") return true

            // Just return the flippin' value. Gawsh.
            return target[key]
        }
    }

    return {
        data: deepProxy(data, proxyHandler),
        membrane: {
            unwrapProxy(proxy) {
                return proxy
            }
        },
    }
}

function deepProxy(target, proxyHandler) {
    // If target is null, return it.
    if (target === null) return target;

    // If target is not an object, return it.
    if (typeof target !== 'object') return target;

    // If target is a DOM node (like in the case of this.$el), return it.
    if (target instanceof Node) return target

    // If target is already an Alpine proxy, return it.
    if (target['$isAlpineProxy']) return target;

    // Otherwise proxy the properties recursively.
    // This enables reactivity on setting nested data.
    // Note that if a project is not a valid object, it won't be converted to a proxy
    for (let property in target) {
        target[property] = deepProxy(target[property], proxyHandler)
    }

    return new Proxy(target, proxyHandler)
}
