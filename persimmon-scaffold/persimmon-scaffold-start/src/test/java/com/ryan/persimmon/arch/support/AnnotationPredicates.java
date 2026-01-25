package com.ryan.persimmon.arch.support;

import com.tngtech.archunit.core.domain.JavaAnnotation;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;

public final class AnnotationPredicates {

  private AnnotationPredicates() {}

  public static ArchCondition<JavaClass> notBeAnnotatedWithAnyInPackage(String annotationPackagePrefix) {
    String normalizedPrefix = annotationPackagePrefix.endsWith(".")
      ? annotationPackagePrefix
      : annotationPackagePrefix + ".";

    return new ArchCondition<>("not be annotated with any annotation in package " + normalizedPrefix) {
      @Override
      public void check(JavaClass item, ConditionEvents events) {
        for (JavaAnnotation<?> annotation : item.getAnnotations()) {
          String annotationTypeName = annotation.getRawType().getName();
          if (annotationTypeName.startsWith(normalizedPrefix)) {
            String message = item.getName() + " is annotated with @" + annotationTypeName;
            events.add(SimpleConditionEvent.violated(item, message));
            return;
          }
        }
        events.add(SimpleConditionEvent.satisfied(item, item.getName() + " has no matching annotations"));
      }
    };
  }
}
